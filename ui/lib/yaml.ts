import { promises as fs } from "node:fs";
import YAML from "yaml";

export async function readYaml<T = unknown>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, "utf-8");
  return YAML.parse(text) as T;
}

export async function writeYaml(filePath: string, value: unknown): Promise<void> {
  const text = YAML.stringify(value, { indent: 2 });
  await fs.writeFile(filePath, text, "utf-8");
}

export function parseYaml<T = unknown>(text: string): T {
  return YAML.parse(text) as T;
}

export function stringifyYaml(value: unknown): string {
  return YAML.stringify(value, { indent: 2 });
}
