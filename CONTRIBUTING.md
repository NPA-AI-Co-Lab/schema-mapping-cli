# Contributing to NPA Ingest Insight CLI

Thanks for your interest in helping improve this project! This guide covers how to set up a local environment, make changes with confidence, and submit a pull request that is easy to review.

## Ways to Contribute
- Open issues that describe bugs, confusing behavior, or ideas for improvement.
- Improve documentation, examples, or configuration presets to make the CLI easier to adopt.
- Submit pull requests for fixes, features, or refactors that align with the product goals.
- Review open pull requests and share constructive feedback.

## Before You Start
- Make sure you have [Node.js](https://nodejs.org/) **18 or newer** installed.
- Fork the repository and create a branch for your changes (`feature/my-improvement`).
- Never commit API keys or real personal data. Use the samples in `examples/` and `static/` or craft synthetic datasets.

## Local Setup
1. Clone your fork and move into the project directory.
2. Install dependencies: `npm install`
3. Copy or create a `.env` file if you need to test against an LLM provider. Only add secrets locally.
4. Build the TypeScript sources: `npm run build`

Keep dependencies up to date with your Node version. If you add new packages, include a short explanation in your pull request description.

## Helpful npm Scripts
- `npm run build` compiles TypeScript to `dist/` so you can run the CLI locally.
- `npm run start analyze -- --config ./config.json` executes the CLI without installing it globally.
- `npm run lint` checks the TypeScript sources with ESLint. Use `--fix` locally if it helps, but ensure the repository stays lint-clean.

## Working on the Codebase
- The app is written in TypeScript and organised by responsibility (`src/analysis`, `src/clients`, `src/jsonld`, etc.). Place new modules where they logically belong and keep imports relative to the folder you work in.
- Follow existing naming patterns (`camelCase` for functions, `PascalCase` for types). Export the minimum surface needed.
- Prefer small, composable functions. If a function grows larger than ~50 lines, consider splitting it up.
- When touching LLM-related logic (`src/clients` or `src/analysis`), isolate provider-specific behavior behind interfaces in `src/interfaces/` so new providers can plug in easily.
- Ensure new schema or configuration samples live in `examples/`, and keep them in sync with changes in default behavior.

## Validation Checklist
Before opening a pull request, please run through the following:
- `npm run lint`
- `npm run build`
- Manually exercise the CLI flow you touched (interactive and/or config-driven) when possible.
- Update documentation (`README.md`, `examples/`) if behavior changes.
- Add or update automated checks if you introduce new logic. (The project does not yet have a full test suite. Feel free to include lightweight tests or scripts when it adds value.)
- Mention any follow-up work or known limitations in the pull request description.

## Submitting Pull Requests
- Keep pull requests focused. Smaller changes review faster and are less risky.
- Reference related issues (e.g. `Fixes #123`). If there is no issue, explain the motivation clearly.
- Describe the solution, how you validated it, and any trade-offs.
- Include screenshots or sample CLI output if it clarifies the change.
- Update `CHANGELOG.md` with your pull request documenting the changes you made.

## Code Review Expectations
- Be responsive to review comments and keep the conversation friendly. Push follow-up commits rather than force-pushing unless asked.
- Reviewers aim to respond within a couple of business days. Feel free to ping the thread if you have not heard back after that.
- Reviewers can request additional validation steps when behavior is risky or touches data privacy logic.

## Reporting Issues
- Search existing issues to avoid duplicates.
- Provide context: CLI command, configuration, sample input (redact sensitive data), and the output you expected.
- Include the CLI version (`npa-insight --version` if installed, or `node dist/cli.js --version`) and your Node.js version.

## Security
If you suspect a security problem or data privacy exposure, **do not** open a public issue. Reach out to the maintainers privately (for example via the repository owner on GitHub) so we can triage without exposing sensitive details.

## Thank You
Every contribution, large or small, helps the community use this CLI more effectively. We appreciate your time and welcome your feedback on how to keep improving the contributor experience.
