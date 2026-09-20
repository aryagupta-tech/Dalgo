# Contributing to Dalgo

main is production and develop is staging. Do not commit or push feature work directly to either branch.

1. Start from the latest develop.
2. Create feature/<short-name>.
3. Run the test suite and open a pull request into develop.
4. Test the merged commit at https://staging.dalgo.site.
5. Promote tested work with a develop to main pull request.

Run npm run setup:git-hooks once per checkout to block accidental direct commits and pushes on this computer. GitHub Actions verifies every pull request, deploys develop to staging, and deploys main to production.
