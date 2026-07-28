import { fixupConfigRules } from "@eslint/compat";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [
    ...fixupConfigRules(compat.extends(
        "standard-with-typescript",
        "plugin:n/recommended",
        "plugin:import/recommended",
        "plugin:promise/recommended",
    )),

    {
        languageOptions: {
            globals: {
                ...globals.node,
            },

            ecmaVersion: "latest",
            sourceType: "module",

            parserOptions: {
                project: "./tsconfig.json",
            },
        },

        rules: {
            "@typescript-eslint/prefer-nullish-coalescing": "off",

            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
            }],

            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-misused-promises": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/strict-boolean-expressions": "off",
            "@typescript-eslint/no-throw-literal": "off",
            "@typescript-eslint/consistent-type-imports": "off",
            "@typescript-eslint/naming-convention": "off",
            "@typescript-eslint/indent": "off",
            "@typescript-eslint/comma-dangle": "off",
            "@typescript-eslint/restrict-template-expressions": "off",
            "@typescript-eslint/space-before-function-paren": "off",
            "@typescript-eslint/member-delimiter-style": "off",
            "@typescript-eslint/array-type": "off",
            "@typescript-eslint/consistent-type-definitions": "off",
            "@typescript-eslint/no-use-before-define": "off",
            "@typescript-eslint/no-unnecessary-type-assertion": "off",
            "@typescript-eslint/prefer-reduce-type-parameter": "off",
            "@typescript-eslint/prefer-includes": "off",
            "no-tabs": "off",
            "no-var": "off",
            "object-shorthand": "off",
            "import/no-duplicates": "off",
            "import/no-unresolved": "off",
            "import/no-named-as-default": "off",
            "import/no-named-as-default-member": "off",
            "n/no-missing-import": "off",
            "n/no-process-exit": "off",
            "node/no-unused-vars": "off",
        },
    },

    {
        files: ["**/*.ts"],
    },
];