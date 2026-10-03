# Orbit

> Status: Archived

Orbit is a community and communication platform built around real-time messaging, communities, profiles, social connections, and cross-platform access.

I am no longer actively developing this project, but the source code is available publicly for anyone who wants to study it, experiment with it, or continue developing it.

Issues and pull requests may not receive a response.

## Overview

Orbit was built to provide a modern communication experience across:

- Web browsers
- Windows
- macOS
- Linux
- Mobile and tablet layouts

The frontend uses React and Vite, with Tauri used for desktop packaging.

## Features

Orbit includes or was designed around:

- User accounts and profiles
- Community creation and management
- Text channels
- Direct messages
- Friends and social connections
- Real-time messaging
- Roles and permissions
- User presence
- Notifications
- Community discovery
- File and image attachments
- OAuth connections
- Desktop application support
- Responsive mobile and tablet layouts

Some features may be incomplete or unfinished.

## Tech Stack

- React
- Vite
- JavaScript / TypeScript
- PocketBase
- Tauri
- Node.js
- REST and real-time APIs

## Getting Started

### Requirements

Install:

- Node.js
- npm
- Rust and Cargo, if you want to run the Tauri desktop build
- The Orbit backend services

### Install dependencies

```bash
npm install
```

### Environment variables

Create a local environment file from the example:

```bash
cp .env.example .env
```

Fill in the values needed for your setup.

Do not commit real API keys, OAuth secrets, tokens, or production credentials.

### Start the web app

```bash
npm run dev
```

Vite will print the local development URL in the terminal.

### Build the web app

```bash
npm run build
```

### Run the desktop version

If Tauri is configured in your local checkout:

```bash
npm run tauri dev
```

The exact command may depend on the scripts in `package.json`.

## Backend

Orbit uses separate backend services for application data and authentication-related functionality.

The frontend expects backend URLs to be supplied through environment variables.

See the separate backend repositories for setup instructions.

## Authentication

Orbit supports external account connections and OAuth-based sign-in flows.

Providers worked on include:

- Discord
- Steam
- Twitch
- YouTube
- GitHub

Additional providers may be added by anyone continuing the project.

OAuth secrets must remain server-side and must never be committed to this repository.

## Security

Before running or publishing a fork:

- Never commit `.env` files containing secrets
- Never commit private API keys
- Never commit OAuth client secrets
- Never commit production database files
- Never commit session tokens
- Never hardcode administrator privileges
- Keep sensitive authorization logic on the backend

If a secret was committed previously, remove it from Git history and rotate the credential before making the repository public.

## Development Notes

Orbit was built with a focus on:

- Fast interactions
- Responsive layouts
- Cross-platform support
- Real-time communication
- Maintainable project structure

Anyone continuing the project should preserve working features where possible and test changes before merging them.

## Repository Status

This repository is archived and no longer actively maintained.

You are free to fork it and continue development under the terms of the repository license.

## License

This project is licensed under the MIT License.

You are free to use, modify, and redistribute the code, including for commercial purposes, as long as the original copyright and license notice are kept.
