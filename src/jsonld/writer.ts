import { createWriteStream, WriteStream } from "fs";
import { llmOutputToJsonLd } from "./converter.js";
import { JsonLDWriter } from "./types.js";

/**
 * Create a JSON-LD file writer that streams results to a file or stdout
 */
export function createJsonLDWriter(
  outputPath: string,
  jsonLdSchemaPath: string
): JsonLDWriter {
  let isFirst = true;
  const stream = outputPath ? createWriteStream(outputPath) : process.stdout;

  if (stream !== process.stdout) {
    (stream as WriteStream).write("[\n");
  } else {
    process.stdout.write("[\n");
  }

  return {
    write: async (results: Record<string, unknown>[]) => {
      for (const result of results) {
        const jsonLdResult = llmOutputToJsonLd(jsonLdSchemaPath, result);
        if (!isFirst) {
          if (stream !== process.stdout) {
            (stream as WriteStream).write(",\n");
          } else {
            process.stdout.write(",\n");
          }
        }
        const output = JSON.stringify(jsonLdResult, null, 2);
        if (stream !== process.stdout) {
          (stream as WriteStream).write(output);
        } else {
          process.stdout.write(output);
        }
        isFirst = false;
      }
    },
    finalize: async () => {
      return new Promise<void>((resolve) => {
        if (stream !== process.stdout) {
          (stream as WriteStream).write("\n]");
          (stream as WriteStream).end(() => resolve());
        } else {
          process.stdout.write("\n]");
          resolve();
        }
      });
    },
  };
}
