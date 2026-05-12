export function createSequentialTaskRunner() {
  let chain = Promise.resolve();

  return {
    run(task) {
      const result = chain.then(() => task());
      chain = result.catch(() => {});
      return result;
    }
  };
}
