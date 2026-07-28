<h1 align="center">Simmer REST API Template 🚀</h1> <div align="center">
<img width="966" alt="node-ts-api" src="https://github.com/oaguirre/simmer.git">


</div>
Simmer API

## 🌟 Features

- ⚡ SWC for blazing-fast builds compared to TSC
- 🔒 JWT tokens for user authentication and routes protection
- 📚 Ready-to-go user model, controller, sign up, and sign in routes
- ⚡ Optional websockets built with Socket.io
- 🖼️ Image uploads with Multer
- 🔧 Environment variables management with dotenv
- 💡 Error handling
- 📝 Asynchronous logging with Pino
- ☁️ Ready-to-go access to AWS Parameter Store
- 🔄 **Consistent API Response Shapes**: All moment/date endpoints guarantee uniform `user_a` and `user_b` object structures
- 🛡️ **Privacy-First Design**: User data explicitly constructed with public fields only; private data never exposed
- 📦 **Optimized Dependencies**: Sharp deduplication and ONNX runtime logging suppression for clean builds

## 🚀 Getting Started

1. Install dependencies: `npm install --legacy-peer-deps`
2. Create a .env file with your configurations.
3. Start the development server with `npm start`.
4. The API will be running on the port specified in the .env file

## � Recent Updates

See [CHANGELOG.md](./CHANGELOG.md) for detailed release notes. Key recent improvements:

- ✅ **Response Shape Consistency** (Commit d29aeff): All moment/date endpoints now guarantee `user_a` and `user_b` are returned as fat objects with `_id`, `first_name`, `avatar_url`, `image_url`
- ✅ **Dependency Deduplication**: Resolved sharp namespace collision via pnpm overrides and postinstall script
- ✅ **Clean Startup Logs**: ONNX runtime warnings suppressed with `ORT_LOG_LEVEL=0` and grep filtering

## �📚 Usage

The template includes a basic user model and routes for sign up and sign in. You can easily add more models and routes as needed.

### Authentication

All routes are protected by default and require a valid JWT token to be included in the `Authorization` header of the request.

### Privacy and PII Hardening

The API includes response-layer and schema-layer protections to reduce accidental exposure of sensitive user data.

- Sensitive user fields are hidden by default at the schema level using `select: false` (for example: password, email, phone, precise location fields, and date of birth).
- User responses are shaped through explicit serializers for self and public profile views.
- Auth responses (`signup` and `signin`) return sanitized user payloads (no password hash, no unsafe raw document output).
- Public profile responses explicitly exclude private attributes that are not required for discovery.
- Login existence checks use a generic response shape to prevent account enumeration.
- Regression tests cover auth and profile PII exposure behavior.

### Security Guardrails

- CORS uses an explicit allowlist and rejects lookalike origins (for example, `allowed-domain.evil.com`).
- Optional environment overrides:
  - `CORS_ALLOWED_ORIGINS` (comma-separated exact origins)
  - `CORS_ALLOWED_HOST_SUFFIXES` (comma-separated host suffixes, https only)
- CI blocks merges when likely hardcoded secrets or unsafe CSP directives are detected.
- Run locally with: `npm run security:check`

#### Response Data Consistency

All endpoints returning moment/date data (POST `/api/user/meet`, GET/PATCH `/api/moment`) guarantee consistent response structures:

```json
{
  "data": {
    "user_a": {
      "_id": "ObjectId",
      "first_name": "string",
      "avatar_url": "S3 presigned URL",
      "image_url": "S3 presigned URL"
    },
    "user_b": {
      "_id": "ObjectId",
      "first_name": "string",
      "avatar_url": "S3 presigned URL",
      "image_url": "S3 presigned URL"
    }
  }
}
```

- Both `user_a` and `user_b` have identical structure across all endpoints
- User data is explicitly constructed with public fields only (privacy by design, not filtering)
- Non-requester users receive only the 4 public fields above, never private data
- This guarantee is maintained even after moments are updated

#### PII-protected fields

The following fields are treated as sensitive and are either hidden by default or excluded from public responses:

- `password`
- `email`
- `phone`
- `loc_latitude`
- `loc_longitude`
- `loc_address`
- `loc_postal_code`
- `date_of_birth`

### Maintenance Scripts

- `npm run users:dob-backfill -- --file=/absolute/path/to/backup.csv`
	Runs a dry-run that reads a backup CSV/TSV, normalizes `_id` values like `ObjectId(...)`, and reports which users would have `date_of_birth` backfilled.
- `npm run users:dob-backfill -- --file=/absolute/path/to/backup.csv --apply`
	Applies the backfill for users whose current `date_of_birth` is `null`.
- `npm run users:dob-backfill --file=/absolute/path/to/backup.csv --write`
	Applies writes when using npm arguments without the `--` separator.
- `npm run users:dob-backfill -- --file=/absolute/path/to/backup.csv --apply --include-missing-field`
	Also applies the backfill for users where the `date_of_birth` field is missing entirely.

### Websockets

The template includes an optional implementation of websockets using Socket.io.

### Ember MCP Server

This repository now includes an MCP server for Ember coaching workflows.

- Entry point: `src/mcp/emberMcpServer.mjs`
- Run: `npm run mcp:ember`
- Transport: stdio (for MCP hosts like Claude Desktop, Cursor, VS Code MCP clients)

Required environment variables:

- `SIMMER_API_BASE_URL` (example: `https://api.simmerdate.com`)
- `SIMMER_BEARER_TOKEN` (JWT bearer token)

Optional environment variable:

- `SIMMER_ALLOWED_API_PREFIXES` comma-separated allowlist for `call_simmer_api`.
- Default: `/api/user,/api/relationship,/api/dating-meet,/api/moment,/api/moments,/api/learning`

Exposed MCP tools:

- `explore_matches`: fetch potential matches (`GET /api/user/explore-dates`)
- `create_virtual_date`: trigger virtual date simulation (`POST /api/user/meet`)
- `update_my_profile`: patch current user profile (`PATCH /api/user`)
- `relationship_context`: fetch profile + relationship + recent date moments for coaching context
- `call_simmer_api`: generic authenticated API caller for any endpoint

Example MCP client command:

```json
{
  "command": "npm",
  "args": ["run", "mcp:ember"],
  "env": {
    "SIMMER_API_BASE_URL": "https://api.simmerdate.com",
    "SIMMER_BEARER_TOKEN": "<JWT_TOKEN>"
  }
}
```

Client-specific config snippets:

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ember-coach": {
      "command": "npm",
      "args": ["run", "mcp:ember"],
      "cwd": "/Users/omaraguirre/Projects/simmer-ember",
      "env": {
        "SIMMER_API_BASE_URL": "https://api.simmerdate.com",
        "SIMMER_BEARER_TOKEN": "<JWT_TOKEN>",
        "SIMMER_ALLOWED_API_PREFIXES": "/api/user,/api/relationship,/api/dating-meet,/api/moment,/api/moments,/api/learning"
      }
    }
  }
}
```

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ember-coach": {
      "command": "npm",
      "args": ["run", "mcp:ember"],
      "cwd": "/Users/omaraguirre/Projects/simmer-ember",
      "env": {
        "SIMMER_API_BASE_URL": "https://api.simmerdate.com",
        "SIMMER_BEARER_TOKEN": "<JWT_TOKEN>",
        "SIMMER_ALLOWED_API_PREFIXES": "/api/user,/api/relationship,/api/dating-meet,/api/moment,/api/moments,/api/learning"
      }
    }
  }
}
```

VS Code MCP (`settings.json` style):

```json
{
  "mcp.servers": {
    "ember-coach": {
      "command": "npm",
      "args": ["run", "mcp:ember"],
      "cwd": "/Users/omaraguirre/Projects/simmer-ember",
      "env": {
        "SIMMER_API_BASE_URL": "https://api.simmerdate.com",
        "SIMMER_BEARER_TOKEN": "<JWT_TOKEN>",
        "SIMMER_ALLOWED_API_PREFIXES": "/api/user,/api/relationship,/api/dating-meet,/api/moment,/api/moments,/api/learning"
      }
    }
  }
}
```

Smoke test:

- Run: `npm run mcp:ember:smoke`
- Validates: bearer token auth + one protected API call (`GET /api/user`)

## 🛠️ Built With

- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- [Typescript](https://www.typescriptlang.org/)
- [Mongoose](https://mongoosejs.com/)
- [JWT](https://jwt.io/)
- [Multer](https://www.npmjs.com/package/multer)
- [dotenv](https://www.npmjs.com/package/dotenv)
- [Pino](https://getpino.io/)
- [Socket.io](https://socket.io/)

## 📝 To-do's

- Nodemailer for easy email sending
- Twilio for SMS verification
- Rate limiting
- Password reset functionality
- Support for different database types (PostgreSQL, MySQL)
- Caching (Redis)
- Password hashing with Argon

## 📄 License

