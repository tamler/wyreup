module.exports = {
  hooks: {
    beforePacking(pkg) {
      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]) {
        const dependencies = pkg[field];
        if (dependencies != null) {
          pkg[field] = Object.fromEntries(
            Object.keys(dependencies)
              .sort()
              .map((name) => [name, dependencies[name]]),
          );
        }
      }
      return pkg;
    },
  },
};
