# Expense Manager Backend

A RESTful API for an Expense Management application built with Node.js, Express, and MongoDB. The backend includes JWT authentication, role-based authorization, request validation, profile-image uploads, and automated API tests.

## Tech Stack

- Node.js and Express.js
- MongoDB and Mongoose
- JSON Web Tokens (JWT)
- Zod request validation
- AWS S3 profile-image storage
- Jest and Supertest
- ESLint

## Features

- User registration and login
- JWT-protected API routes
- Role-based access control
- Expense creation, retrieval, updating, and deletion
- User profile management
- Profile-image upload validation
- MongoDB persistence
- Automated authentication, authorization, and API tests
- Environment-variable validation

## Project Structure

```text
Expense-Manager-backend/
├── app.js
├── server.js
├── src/
│   ├── config/
│   │   └── validateEnv.js
│   ├── middleware/
│   ├── routes/
│   ├── Controllers/
│   ├── models/
│   ├── services/
│   ├── utiles/
│   └── validations/
├── tests/
├── .env.example
├── .gitignore
├── jest.config.js
└── package.json
```

## Prerequisites

- Node.js and npm
- A MongoDB instance
- AWS S3 credentials if profile-image uploads are enabled
- Email-provider credentials if email features are enabled
- A Gemini API key if Gemini-powered features are enabled

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/patel192/Learn-25-node.git
cd Learn-25-node
npm install
```

## Environment Configuration

Copy `.env.example` to `.env` and configure the values for your environment.

Required core variables:

```dotenv
PORT=3001
NODE_ENV=development
JWT_SECRET=
MONGO_URI=
```

Configure `REFRESH_SECRET`, `MONGO_URI_TEST`, email, Gemini, and AWS variables according to the features you use.

Use securely generated secrets. Never commit `.env` or expose credentials in logs, screenshots, or source control.

## Running the Server

Start the application using the scripts defined in `package.json`:

```bash
npm start
```

If a development script is configured, you can use:

```bash
npm run dev
```

The server connects to MongoDB before listening on the configured port. The default port in the current server configuration is `3001`.

## Testing

Run ESLint:

```bash
npm run lint
```

Run the Jest test suite:

```bash
npm test -- --runInBand
```

Configure `MONGO_URI_TEST` to point to a dedicated test database. Never run destructive tests against production data.

The current test suite covers authentication flows, authorization, expense operations, health checks, and profile-upload restrictions.

## API Overview

The API includes routes for user authentication, user profiles, and expense management. Protected endpoints require a valid access token and enforce authorization rules where configured.

Example request header:

```http
Authorization: Bearer <access-token>
```

Consult the route definitions in `src/routes/` for the exact endpoint paths, HTTP methods, request schemas, and authorization requirements.

## Security Notes

- Keep environment secrets out of source control.
- Use strong JWT secrets.
- Validate request bodies before processing them.
- Restrict access to protected resources.
- Validate uploaded image types and file sizes.
- Keep dependencies updated and run lint and tests before deployment.

## Continuous Integration

The repository includes a GitHub Actions CI workflow at `.github/workflows/ci.yml`, according to the existing project documentation.

Review the workflow configuration to confirm its current triggers and checks.

## License

Add the project's license information here if applicable.
