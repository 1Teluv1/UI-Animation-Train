# Game Asset Video Pipeline

LM Studio가 작성한 HTML 애니메이션을 MP4 데이터셋으로 만들고, 그 데이터셋으로 **Wan2.2 5B**에 LoRA를 학습시키기 위한 파이프라인.

전체 흐름:

```
spec → LM Studio (HTML) → Playwright 캡처 → ffmpeg MP4 → metadata.jsonl
                                                    ↓
                           Phase 2 검증/dedupe/split → train_metadata.jsonl
                                                    ↓
                                       Wan2.2 LoRA 학습 → lora.safetensors → 샘플 추론
```

---

## 1. 사전 준비물

| 항목 | 비고 |
|------|------|
| **Python 3.10+** | 본 프로젝트는 3.12.10에서 검증됨 |
| **NVIDIA GPU + CUDA** | RTX 5080 16GB에서 검증. Phase 3 LoRA 학습 권장 사양 |
| **LM Studio (서버 모드)** | `http://localhost:1234/v1`, OpenAI 호환 모드 활성화. 코드 생성용 모델(Qwen2.5-Coder-7B-Instruct 이상 권장) 로드 |
| **ffmpeg** | PATH 등록 또는 `pip install imageio-ffmpeg`로 자동 fallback (이미 requirements에 포함) |
| **Wan2.2-TI2V-5B (diffusers 포맷)** | Phase 3에서만 필요. 예: `huggingface-cli download Wan-AI/Wan2.2-TI2V-5B-Diffusers --local-dir ./models/Wan2.2-TI2V-5B` |

### 설치

```powershell
cd f:\AI\UI-Animation-Train\game_asset_video_pipeline
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium
```

> torch는 사용자 환경(예: `2.11.0 + CUDA 13.2`)을 그대로 사용합니다. 별도 설치가 필요하면 [pytorch.org](https://pytorch.org/get-started/locally/)에서 자신의 CUDA 버전에 맞는 wheel을 받으세요.

### (선택) 환경변수 오버라이드

| 변수 | 기본값 |
|------|--------|
| `LMSTUDIO_BASE_URL` | `http://localhost:1234/v1` |
| `LMSTUDIO_MODEL`    | `local-model` |
| `LMSTUDIO_API_KEY`  | `lm-studio` |
| `LMSTUDIO_TIMEOUT`  | `180` (초) |
| `LMSTUDIO_MAX_RETRIES` | `3` |
| `FFMPEG_BIN` / `FFPROBE_BIN` | PATH의 `ffmpeg` / `ffprobe` |
| `DATASET_ROOT` | `<repo>/dataset` |

---

## 2. Phase 1 — HTML 애니메이션 데이터셋 생성

### LM Studio로 LLM 생성:

```powershell
python scripts/generate_dataset.py --count 100 --category ui_reward --verbose
```

### Prompt bank 기반 LLM 생성:

```powershell
python scripts/generate_dataset.py --count 2 --category ui_reward --verbose
```

지원 카테고리: `ui_reward`, `emoji_motion`, `game_vfx`, `item_showcase`, `button_motion`.

생성 결과:

```
dataset/
  html/<id>.html
  videos/<id>.mp4    # 512x512, 24fps, libx264 yuv420p
  metadata.jsonl     # 한 줄에 한 샘플
  failed.jsonl       # 실패한 spec + error message
```

`metadata.jsonl` 한 줄 예시:

```json
{"id":"ui_reward_gold_coin_icon_0000","video":"videos/ui_reward_gold_coin_icon_0000.mp4",
 "html":"html/ui_reward_gold_coin_icon_0000.html","caption":"[UI_REWARD] A polished mobile game UI icon ...",
 "asset_type":"ui_reward","subject":"gold coin icon","motion_preset":"reward_burst",
 "duration":2.0,"fps":24,"resolution":"512x512","source":"prompt_bank", ...}
```

CLI 옵션:

| 옵션 | 설명 |
|------|------|
| `--count N` | 생성할 샘플 수 (필수) |
| `--category ...` | 카테고리 (필수) |
| `--start-id N` | 시작 인덱스 (기본: 기존 metadata 다음) |
| `--prompt-bank PATH` | user prompt bank JSON 경로 (기본: `lmstudio/data/user_prompt_bank.json`) |
| `--also-webm` | MP4와 함께 WebM도 출력 |
| `--keep-frames` | PNG 프레임을 보존 (디버깅용) |
| `--verbose` | stderr에 진행/오류 로그 출력 |

> **로그 정책**: 사용자 룰에 따라 `--verbose` 없이는 디버그 로그를 출력하지 않습니다.

---

## 3. Phase 2 — 데이터셋 정규화 / 품질 검사 / Split

```powershell
python scripts/preprocess_dataset.py --verbose
```

검사 항목:

- 영상 존재/디코드 가능성 (OpenCV; ffprobe 있으면 우선)
- 해상도 = `--resolution` (기본 512), fps = `--fps` (기본 24)
- 선언된 duration vs 실제 duration (허용 오차 `--duration-tolerance`, 기본 0.05s)
- frame_count = duration × fps (±1 프레임 허용)
- 인접 프레임 그레이스케일 차이의 평균 = motion_score, `--min-motion`(기본 2.0) 미만 탈락
- 첫/중간/끝 프레임의 dHash(192-bit) 거리 ≤ `--duplicate-threshold`(기본 8)이면 중복으로 제거
- 카테고리별 stratified 9:1 train/val split (`--val-ratio 0.1`)

산출물:

```
dataset/
  processed/train_metadata.jsonl
  processed/val_metadata.jsonl
  quality_report.jsonl   # 모든 샘플의 모든 메트릭 + pass/fail 사유
```

---

## 4. Phase 3 — Wan2.2 5B LoRA 학습

### 4.1 모델 가중치 준비

```powershell
huggingface-cli download Wan-AI/Wan2.2-TI2V-5B-Diffusers --local-dir .\models\Wan2.2-TI2V-5B
```

이후 `train/lora_config.yaml`의 `model.base_model_path`가 위 경로와 일치하는지 확인합니다.

### 4.2 설정

`train/lora_config.yaml`의 핵심 항목:

- `train.batch_size: 1`, `gradient_accumulation_steps: 8`
- `train.mixed_precision: "bf16"`, `gradient_checkpointing: true`
- `train.optim: "adamw"` (16GB GPU에서 OOM 시 `"adamw_8bit"` + `pip install bitsandbytes`)
- `lora.rank: 64`, `alpha: 64`, target_modules: q/k/v/o + to_q/to_k/to_v/to_out

### 4.3 Smoke 테스트 (1 optimizer step)

```powershell
python scripts/train_wan_lora.py --smoke-test --verbose
```

가중치가 없으면 다음과 같이 **명확한 안내** 후 종료(exit 2):

```
[train] cannot load Wan2.2 components: Wan2.2 model directory not found: ./models/Wan2.2-TI2V-5B
Download the diffusers-format checkpoint (e.g. Wan-AI/Wan2.2-TI2V-5B-Diffusers) and update model.base_model_path in lora_config.yaml.
```

### 4.4 본 학습

```powershell
python scripts/train_wan_lora.py --verbose
```

체크포인트:

```
outputs/icon_lora/
  checkpoint-000500/
  checkpoint-001000/
  final/                # peft.save_pretrained 결과 (또는 lora.safetensors)
```

> Wan transformer의 forward 인자/스케줄러 prediction_type은 diffusers 빌드에 따라 달라질 수 있습니다. 변경이 필요하면 `train/train_lora.py`의 `# TODO[wan]` 주석을 참조해 한 줄만 조정하세요.

### 4.5 샘플 추론

```powershell
python scripts/sample_inference.py --lora .\outputs\icon_lora\final --verbose
```

`--prompts prompts.txt` 옵션으로 직접 프롬프트 파일도 지정 가능. 출력은 `outputs/icon_lora/final/sample_videos/sample_0N.mp4`.

기본 테스트 프롬프트 3종:

```
[UI_REWARD] A shiny gold coin icon pops upward, spins once, emits small sparkles, then settles down.
[EMOJI_MOTION] A cute yellow emoji smiles widely, bounces twice, sparkles around its face, then gently returns.
[GAME_VFX] A stylized blue magic burst appears at the center, expands outward, releases tiny glowing particles.
```

---

## 5. 디렉터리 구조

```
game_asset_video_pipeline/
  app/                  # 공통 설정 (config.py)
  lmstudio/             # OpenAI 호환 클라이언트 + 시스템 프롬프트
  html_generator/
    generate_html.py    # LLM 호출 + fallback 템플릿 분기
    templates/          # 5개 카테고리 fallback HTML
  renderer/
    browser_capture.py  # Playwright (chromium) 프레임 캡처
    render_html_to_video.py  # ffmpeg encode (mp4 / 옵션 webm)
  caption/caption_builder.py
  train/
    dataset_loader.py   # WanLoraDataset (decord / torchvision / OpenCV fallback)
    wan_loader.py       # diffusers WanPipeline 컴포넌트 분리 로딩
    train_lora.py       # accelerate + peft 학습 골격
    lora_config.yaml
  scripts/
    generate_dataset.py
    preprocess_dataset.py
    train_wan_lora.py
    sample_inference.py
  dataset/              # 런타임 생성 (gitignored)
  requirements.txt
  README.md
```

---

## 6. 알려진 제약 / 주의사항

- **Windows + decord**: `num_workers > 0`이면 종종 데드락이 발생합니다. config 기본값은 `num_workers: 0`.
- **bitsandbytes (8bit AdamW)**: Windows wheel은 불안정합니다. 안 되면 `train.optim: "adamw"`로 두세요.
- **외부 CDN 금지**: LLM이 `https://cdn...` 같은 외부 자원을 참조하면 해당 샘플은 `failed.jsonl`에 기록됩니다.
- **워터마크/텍스트 금지**: 시스템 프롬프트에서 강제하지만, 실 검수에서 텍스트가 보이면 해당 샘플을 수동 제외하세요.
- **첫 실험은 100개로 overfit 테스트** (Implementation_plan §15 Phase 3 가이드).
- **Git 자동 동기화 없음** (사용자 룰 #2): commit/push는 명시 요청 시에만 수행됩니다.

---

## 7. 빠른 검증 (방금 만든 환경 기준)

```powershell
# 1) Phase 1 smoke (LM Studio 필요)
python scripts/generate_dataset.py --count 2 --category ui_reward --verbose

# 2) Phase 2
python scripts/preprocess_dataset.py --verbose --val-ratio 0.5

# 3) Phase 3 sanity (Wan2.2 가중치 없으면 명확한 메시지로 종료)
python scripts/train_wan_lora.py --smoke-test --verbose
```

---

자세한 설계 배경은 저장소 루트의 `Implementation_plan.md`를 참고하세요.
