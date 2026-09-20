# Contributing to Dalgo

Dalgo uses two shared branches:

- `develop` is the testing branch deployed to `https://staging.dalgo.site`.
- `main` is the public branch deployed to `https://dalgo.site`.

Commit feature work to `develop`, run the verification suite, and deploy it to staging for review. Promote a tested release with a `develop` to `main` pull request. Never push feature work directly to `main`.

GitHub Actions verifies pushes and pull requests. Cloudflare deployments are explicit release steps because the Worker uses a private VPC binding that must be deployed from an authorized operator session.
