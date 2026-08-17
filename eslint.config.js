// The root workspace has no lintable sources of its own — real linting fans
// out per package via `turbo run lint`, and each package carries its own flat
// config extending packages/config. This file exists so a stray `eslint .`
// at the repo root (tooling wrappers such as rtk, editor integrations, CI
// helpers) resolves a flat config and exits clean instead of erroring with
// "couldn't find an eslint.config file".
module.exports = [{ ignores: ["**/*"] }];
