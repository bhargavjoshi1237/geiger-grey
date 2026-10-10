// Migration config for @geiger/orm; Grey's tables and ledger live in the "grey" schema.
const config = {
  schema: "grey",
  url: process.env.STRING_URI,
};

export default config;
