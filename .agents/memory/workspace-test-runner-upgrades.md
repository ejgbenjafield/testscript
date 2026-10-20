---
name: Workspace test-runner upgrades
description: Replit npm firewall and test-runner version alignment across npm workspaces.
---

When the Replit package firewall blocks a test-runner dependency, inspect every workspace manifest: npm install resolves dependencies across the full workspace, so upgrading only the workspace where the error first appeared can leave the old version requested elsewhere. Keep the replacement compatible with the configured Node runtime.

**Why:** A blocked transitive dependency led npm to fetch the previous Vitest version from a second workspace, even after the API workspace had been updated.

**How to apply:** Search all workspace package manifests for the test runner before retrying installation. Upgrade the package in each workspace that declares it, then restart the workflow.
