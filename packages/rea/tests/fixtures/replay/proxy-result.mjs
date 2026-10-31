export default () =>
  new Proxy(
    { hidden: true },
    {
      ownKeys() {
        throw new Error("proxy trap must not run");
      },
    },
  );
