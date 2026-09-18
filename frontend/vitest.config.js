// Vitest configuration for frontend unit test suite (ENG-07)
module.exports = {
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.spec.ts"],
  },
};
