# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [2.1.0] -2026-03-02

### Added

- `forceReingestion` configuration option;
- Better DB logic and deduplication;
- Clear error messages;

## [2.0.0] - 2026-02-23

### Added

- Multi-file CSV processing with UUID-based merging
- SQLite persistence layer with a seven-table schema
- Resume modes: `auto`, `fresh`, `resume`
- File ingestion manager and file tracking (SHA256)
- Configuration normalization for legacy single-file configs
- `dataPaths` and `databasePath` configuration options
- Database-backed streaming processing and repository pattern

### Changed

- Checkpoint files replaced by SQLite (breaking)
- Pipeline redesigned for multi-file processing
- CLI now uses `pipeline-db.ts`
- Streaming processor queries the database instead of using in-memory maps

### Fixed

- Resume reliability and concurrent processing (WAL mode)
- Memory usage for large datasets

### Documentation

- Updated `README.md` multi-file processing section

## [0.8.4] - 2025-10-29

### Fixed

- Retry logic;
- Duplicate column handling;

## [0.8.3] - 2025-10-29

### Fixed

- Small client configuration fix for better performance;

## [0.8.2] - 2025-10-28

### Fixed

- Better error handling;

## [0.8.1] - 2025-10-22

### Added

- Better memory handling;
- Analysis resumption;

### Fixed

- Better error handling;

## [0.8.0] - 2025-10-21

### Added

- Support of rule-based processing;
- Proper UUID handling with ability to specify generating field;
- Better logging


## [0.7.1] - 2025-10-07

### Fixed

- Included test files to linting;


## [0.7.0] - 2025-10-02

### Added

- Unittests;
- More inline comments;
- Prettier formatting;

## [0.6.0] - 2025-10-02

### Added

- PII handing in free text - catching common types (email, phone, address) via regex;

### Fixed

- Better handling for not missing objectID;
- "requiredFieldErrorsFailBatch" flag behavior fix;

### Fixed

- Added SemVer mention in README.md;

## [0.5.3] - 2025-06-10

### Fixed

- Added "emailaddress" pii field, as well as guidelines about pii to README.


## [0.5.2] - 2025-09-29

### Fixed

- Added SemVer mention in README.md;

## [0.5.1] - 2025-09-26

### Fixed

- Config to have a ready example;

## [0.5.0] - 2025-09-26

### Added

- Better flexibility for argument passing;
- Stdout output;
- Updated README;

### Changed

- Moved all non-private data from .env to config;
- Large refactor to make the logic more modular;
- Refactor to decouple AI agent and Business parts of the program;

## [0.4.5] - 2025-09-17

### Fixed

- Updated incorrect user interruption handling logic;

## [0.4.4] - 2025-09-17

### Changed

- Fixed accidental schema deletion and updated it to better handle certain fields;
- Changed example file back to mock from real, to avoid spreading sensitive information;


## [0.4.3] - 2025-09-17

### Added

- Enhanced handling of required fields to ensure they are processed correctly when possible;
- Optional warning-only mode of required fields validation;
- Better edge case handling (for example, proper handling of a completely empty row);
- Example data based on actual client's input.

### Changed

- Minor PII encoding update to support more field formats;
- Enhanced OpenAI API prompt to improve performance based on the feedback from testing on client's data.


## [0.3.3] - 2025-09-12

### Added

- UUID generation based on email;
- Record merging based on UUID;

### Fixed

- Required fields witout format being silently left empty;


## [0.3.2] - 2025-09-10

### Added

- Ability to set config path as a CLI argument;
- Ability to set output path in the config;
- Ability to provide OpenAPI Key via .env file;

## [0.3.1] - 2025-09-06

### Added

- Docstrings for the types defined in the project;

### Changed

- Code refactoring for better readability;
- String validation logic fix to not accept "" for required fields.

## [0.3.0] - 2025-09-06

### Added

- Logging of erroneous API responses (wrong field formats, missing fields etc);
- Proper handling of formats and patterns from the input schema;
- Introduced taxonomies into the input schema and corresponding logic;

## [0.2.1] - 2025-08-29

### Changed

- Several code parts were refactored for simplification and decomposition.

### Removed

- Shortened the AI instructions by removing a redundant example.

## [0.2.0] - 2025-08-27

### Added

- Parallel processing with 5 concurrent processes.
- Added better output validation.
- Added better error handling for API-sided errors.
- Added better error handling for program errors or user interruption.
- Global constants were moved into a newly added .env file.
- Spinner now shows the current progress of the analysis.
- Optional field-based PII handling.
- Optional OpenAI prompts logging.
- JSONLD output format.

### Changed

- Structure rehaul for better user experience.
- Changed input schema structure and parsing logic to simplyfy usage.
- Default output file name now includes timestamp for easier differentiation.

### Removed

- Removed csv and plain json outputs.

## [0.1.0] - 2025-08-06

### Added

- Main structure of the project, including:
    - This CHANGELOG file to log the changes to the project.
    - README file with basic instructions and information on the project.
    - "src/" folder with main code in TypeScript + linting.
    - "static/" with other important files, like basic instructions for the GPT model.
    - "examples/" with sample input files (config and schema).
    - Other basic files (.gitignore, package.json, package-lock.json, tsconfig.json).
