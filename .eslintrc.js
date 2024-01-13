module.exports = {
    "env": {
        "browser": true,
        "es2021": true
    },
    "extends": [
        "standard-with-typescript",
        "prettier",
    ],
    "overrides": [
        {
            "env": {
                "node": true
            },
            "files": [
                ".eslintrc.{js,cjs}"
            ],
            "parserOptions": {
                "sourceType": "script"
            }
        },
        {
            "files": ["tests/**"],
            "parserOptions": {
                "project": "./tsconfig.test.json"
            },
        }
    ],
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
    "rules": {
        "@typescript-eslint/semi": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/array-type": ["error", { "default": "generic" }],
        "@typescript-eslint/dot-notation": "off",
        "@typescript-eslint/consistent-type-definitions": "off",
        "@typescript-eslint/no-namespace": "off",
        "@typescript-eslint/consistent-type-assertions": "off",
        "@typescript-eslint/strict-boolean-expressions": "off",
        "@typescript-eslint/method-signature-style": "off",
        "@typescript-eslint/prefer-nullish-coalescing": "off",
        "prefer-const": "off",
        "promise/param-names": "off",
    }
}
