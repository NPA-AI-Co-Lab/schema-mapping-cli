import { Command } from "commander";
import { CliOptions, PackageInfo } from "./cli-types.js";
import { runAnalyzeCommand } from "./cli-commands.js";

/**
 * Setup and configure the CLI program with commands and options
 */
export function setupCliProgram(program: Command, pkg: PackageInfo) {
  program.name(pkg.name).description(pkg.description || '').version(pkg.version);

  // Configure the analyze command
  program
    .command("analyze")
    .description("Analyze CSV data using AI and output structured results")
    .option("-i, --input <file>", "Input CSV file path")
    .option("-s, --schema <file>", "JSON-LD schema file path")
    .option("-o, --output <file>", "Output file path (optional, use stdout if not specified)")
    .option("-c, --config <file>", "Configuration file path (defaults override config file)")
    .option("--batch-size <number>", "Number of records per batch (1-50)")
    .option("--concurrency <number>", "Number of concurrent requests (1-20)")
    .option("--retries <number>", "Number of retry attempts (0-10)")
    .option("--model <name>", "LLM model name (e.g., gpt-4.1-mini)")
    .option("--fallback-model <name>", "Fallback LLM model name")
    .option("--logging", "Enable detailed logging")
    .option("--hide-pii", "Enable PII protection")
    .option("--required-fields-fail-batch", "Fail entire batch on required field errors")
    .option("--stdout", "Output results to stdout instead of file")
    .option("-q, --quiet", "Suppress informational output (stderr)")
    .action((options: CliOptions) => runAnalyzeCommand(options, pkg));

  program.addHelpText('after', `

Examples:
  # Interactive mode (traditional usage)
  ${pkg.name} analyze

  # Basic usage with config file
  ${pkg.name} analyze -c config.json

  # Override config with CLI options
  ${pkg.name} analyze -c config.json --batch-size 10 --model gpt-4.1

  # CLI-only (no config file)
  ${pkg.name} analyze -i data.csv -s schema.jsonld -o results.jsonld

  # UNIX-style pipeline usage
  ${pkg.name} analyze -i data.csv -s schema.jsonld --stdout > results.jsonld

  # Quiet mode for scripting
  ${pkg.name} analyze -i data.csv -s schema.jsonld --stdout --quiet > results.jsonld

  # Custom processing parameters
  ${pkg.name} analyze -i data.csv -s schema.jsonld --batch-size 3 --concurrency 2 --retries 3

Note:
  - Running without -i/--input or -c/--config will start interactive mode
  - Use --stdout for UNIX-style pipeline compatibility
  - Use --quiet to suppress informational messages for scripting
`);
}
