import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import astro from "eslint-plugin-astro";
import prettier from "eslint-plugin-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

// parsers
const tsParser = tseslint.parser;
const astroParser = astro.parser;

export default defineConfig([
  // Global configuration
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // Base configs
  js.configs.recommended,
  tseslint.configs.recommended,

  {
    plugins: {
      prettier: prettier,
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "prettier/prettier": "off",
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",
      "@typescript-eslint/no-explicit-any": "off", // you may want this as it can get annoying
      "@typescript-eslint/no-unused-vars": "off", // I sometimes purposely have unused vars as this is a template
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },

  // astro setup
  astro.configs.recommended,
  astro.configs["jsx-a11y-recommended"],
  {
    files: ["**/*.astro"],
    languageOptions: {
      parser: astroParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: [".astro"],
        sourceType: "module",
        ecmaVersion: "latest",
        project: "./tsconfig.json",
      },
    },
    rules: {
      "no-undef": "off", // Disable "not defined" errors for specific Astro types that are globally available (ImageMetadata)
      "@typescript-eslint/no-explicit-any": "off", // you may want this as it can get annoying
      "@typescript-eslint/no-unused-vars": "off", // I sometimes purposely have unused vars as this is a template
      "astro/jsx-a11y/anchor-is-valid": "off", // Disable anchor-is-valid rule for Astro files as this is a template
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },

  // Ignore patterns
  {
    ignores: [
      "dist/**",
      "**/*.d.ts",
      ".tours/",
      "src/docs/scripts/**",
      "scripts/",
      "public/pagefind/",
      ".github/",
      ".netlify/",
      ".changeset/",
    ],
  },
]);
