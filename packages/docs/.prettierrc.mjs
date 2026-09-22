/** @type {import("prettier").Config} */
export default {
  printWidth: 100,
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "all",
  useTabs: false,
  plugins: ["prettier-plugin-astro", "prettier-plugin-tailwindcss"],
  overrides: [
    {
      files: [".*", "*.md", "*.toml", "*.yml"],
      options: {
        useTabs: false,
      },
    },
    {
      files: ["**/*.mdx"],
      options: {
        /**
         * feel free to change this. Keystatic expects a certain format for JSX components in MDX files
         * and me setting this to 80 forces my demo files to work correctly
         * I suggest EITHER using keystatic for all blog posts, OR using MD/MDX for all blog posts
         *
         * IF using keystatic, I recommend uncommenting the MDX formatting line in .prettierignore
         */
        printWidth: 80,
      },
    },
    {
      files: ["**/*.astro"],
      options: {
        parser: "astro",
      },
    },
  ],
};
