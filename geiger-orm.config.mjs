// Migration config for @geiger/orm; Grey's tables and ledger live in the "grey" schema.
export default {
  schema: "grey",
  url: process.env.STRING_URI,
};
