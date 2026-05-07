# UI-Animation-Train Console (Next.js)

`npm start` 한 번으로 띄우는 Next.js 14 + TypeScript 데스크톱 콘솔.
부모 디렉터리의 [`game_asset_video_pipeline/`](../game_asset_video_pipeline/)의 Python 파이프라인을 브라우저에서 트리거/모니터링/미리보기까지 한 번에 처리합니다.

기능 요약:
- **Dashboard**: Python · ffmpeg · GPU · LM Studio · 데이터셋 통계
- **Generate (Phase 1)**: 카테고리/카운트/duration 입력 → SSE 실시간 로그 → 영상 미리보기
- **Dataset**: metadata.jsonl 페이징 + 카테고리/소스 필터 + 그리드/테이블 뷰
- **Preprocess (Phase 2)**: motion score / dedup / split → 결과 카드
- **Quality**: motion score 히스토그램 + 실패 사유 그룹 + 샘플별 메트릭 테이블
- **Train (Phase 3)**: Monaco 에디터로 `lora_config.yaml` 편집 + Smoke test + 학습 시작 + 체크포인트 목록
- **Inference**: 체크포인트 선택 + 프롬프트 편집 → SSE 출력

---

## 1. 사전 준비물

| 항목 | 비고 |
|------|------|
| **Node.js 18+** | v22.22.0에서 검증됨 |
| **Python 3.10+** | 부모 디렉터리의 Python 파이프라인 실행에 사용 |
| **`game_asset_video_pipeline/`의 deps** | `pip install -r ../game_asset_video_pipeline/requirements.txt` 권장 |
| **(선택) LM Studio** | LLM 기반 HTML 생성용. 서버 모드 + 모델 로드 |
| **(선택) Wan2.2 가중치** | Train/Inference 페이지 사용 시. 없으면 Smoke test가 명확한 안내 메시지로 종료 |

## 2. 설치 & 실행

```powershell
cd f:\AI\UI-Animation-Train\ui
npm install
npm start
```

기본적으로 `http://127.0.0.1:3000`에 dev 서버가 뜹니다 (외부 접속 차단).

production 빌드를 사용하려면:

```powershell
npm run build
npm run prod
```

## 3. 환경 변수 (`.env.local`)

`.env.example`을 복사한 뒤 필요한 값만 채우세요. 모두 비워도 합리적인 기본값으로 동작합니다.

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PYTHON_BIN` | `python.exe` (Windows) / `python3` (Unix) | 파이프라인을 실행할 Python 인터프리터. venv 사용 시 절대경로로 가리키세요 |
| `PIPELINE_DIR` | `../game_asset_video_pipeline` | 파이프라인 루트 (스크립트/데이터셋이 거기 있어야 함) |
| `LMSTUDIO_BASE_URL` | `http://localhost:1234/v1` | 대시보드의 LM Studio 카드 핑 대상 |

> venv 권장 설정 예 (Windows):
> ```
> PYTHON_BIN=F:/AI/UI-Animation-Train/game_asset_video_pipeline/.venv/Scripts/python.exe
> ```

## 4. 디렉터리 구조

```
ui/
  app/
    layout.tsx · page.tsx (dashboard)
    generate/ · dataset/ · preprocess/ · quality/ · train/ · inference/
    api/
      health · lmstudio/{ping,models} · jobs/[id]/cancel
      dataset/{list,stats,file/[type]/[name]}
      generate · preprocess · quality
      lora-config · train/{smoke,start,status} · inference
  components/
    ui/         (button, card, input, label, switch, select, textarea, badge, separator)
    nav · job-runner · log-viewer · status-badge
    video-player · video-grid · metadata-table · config-editor
  lib/
    paths · types · schemas · safe-path
    yaml · metadata · python (spawn + single-slot job queue) · sse
    utils
```

## 5. 동작 원리 (개요)

```
Browser
  │  HTTP / SSE (EventSource)
  ▼
Next.js API Routes
  │  child_process.spawn (PYTHONUNBUFFERED=1)
  ▼
python scripts/{generate,preprocess,train_wan_lora,sample_inference}.py
  │  stdout/stderr (line-buffered)
  ▼
SSE event: log → 클라이언트 LogViewer 실시간 출력
```

- **단일 슬롯 큐**: 같은 시점에 1개의 Python 작업만 실행됩니다. 다른 작업이 도는 중에 시작 요청이 오면 409 응답 + 진행 중 작업 정보를 반환합니다.
- **취소**: `POST /api/jobs/[id]/cancel` → SIGTERM → 5초 grace → Windows에선 `taskkill /F /T /PID`.
- **파일 서빙**: `/api/dataset/file/[type]/[name]`은 화이트리스트(`videos|html|frames|processed`) + 정규식(`/^[A-Za-z0-9_.-]+$/`) + DATASET_DIR prefix 검증으로 path traversal을 차단하며 `Range` 헤더(206)를 지원합니다.

## 6. 빠른 검증 (smoke 시나리오)

dev 서버를 띄운 뒤 다음 6개를 차례로 확인하면 모든 핵심 경로가 동작합니다.

| # | 시나리오 | 검증 결과 |
|---|----------|-----------|
| 1 | `GET /api/health` | 200 + python/ffmpeg/GPU/Wan2.2 가중치 상태 |
| 2 | `GET /api/dataset/list` | 200 + 기존 metadata.jsonl 페이징 |
| 3 | `GET /api/dataset/file/videos/<id>.mp4` (with `Range`) | 200 + 206 (Partial Content) |
| 4 | `POST /api/generate` (`{count:1, noLlm:true, ...}`) | SSE start → log → exit (code 0) |
| 5 | `POST /api/preprocess` | SSE 정상 종료, `processed/train,val_metadata.jsonl` 생성 |
| 6 | `POST /api/train/smoke` | Wan2.2 가중치 없으면 안내 메시지 + exit 2 |

UI에서는:
1. `/generate` → "Start Generation" (no-llm 토글 켜고 count=2)
2. 종료 후 "Refresh preview" → 영상 인라인 재생 확인
3. `/preprocess` → "Run Preprocess" → `/quality`에 자동 반영
4. `/train` → YAML 편집 후 "Save" → "Smoke Test (1 step)"

## 7. 알려진 제약 / 주의사항

- **로컬 전용**: 인증이 없으므로 외부 호스트에 노출하지 마세요. 기본 listen 주소는 `127.0.0.1`입니다.
- **단일 작업**: 한 번에 한 Python 작업만 실행. 학습은 보통 길어지므로, 학습 중에는 generate/preprocess/inference가 거부됩니다.
- **LM Studio 미실행 시**: 대시보드/Generate 페이지 카드에 "offline"으로 표시. 이때는 `--no-llm` 토글로 fallback 템플릿을 사용하세요.
- **Wan2.2 가중치 없을 때**: Train/Inference는 명확한 에러 메시지로 종료합니다 (UI 정상 동작).
- **`npm start` = `next dev`**: 코드 변경 시 자동 리로드. CPU/메모리 효율은 production 빌드(`npm run prod`)가 더 좋습니다.

## 8. 자주 만나는 문제

- **`'python.exe' was not found on PATH`**: `.env.local`에 `PYTHON_BIN`을 venv의 절대 경로로 설정.
- **`ffmpeg not found`**: `pip install imageio-ffmpeg` (이미 파이프라인 requirements에 포함) 후 다시 시작. 또는 `winget install Gyan.FFmpeg`.
- **카드에 GPU 정보가 안 보임**: `nvidia-smi`가 PATH에 있는지 확인. WSL/CPU 환경이면 정상적으로 빈 카드가 표시됩니다.
- **YAML 편집 시 저장 실패**: 서버에서 yaml.parse를 통과해야 저장됩니다. 에러 토스트의 메시지를 확인하세요.

## 9. 의존성

- runtime: `next 14.2`, `react 18.3`, `swr`, `zod`, `yaml`, `sonner`, `recharts`, `@monaco-editor/react`, Radix UI primitives, `tailwindcss-animate`, `lucide-react`
- dev: `typescript 5`, `tailwindcss 3`, `eslint-config-next 14`

자세한 파이프라인 구조와 동작은 부모 디렉터리의 [`game_asset_video_pipeline/README.md`](../game_asset_video_pipeline/README.md) 참고.
