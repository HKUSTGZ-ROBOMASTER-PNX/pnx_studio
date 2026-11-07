// Resolve firmware when a project opens. An explicit existing selection always wins.
export function createElfResolver({ workspace, host, loadSymbols, clearSymbols, onDetected }) {
  let generation = 0;
  return async function resolveElf(folder) {
    const request = ++generation;
    const configured = workspace.settings.connection?.elf || '';
    const current = () => request === generation && workspace.root === folder && (workspace.settings.connection?.elf || '') === configured;
    clearSymbols();
    try {
      if (configured && await host.fs.isFile(configured)) {
        if (current()) loadSymbols(configured);
        return;
      }
      if (!current()) return;
      const files = await host.workspace.findElfs(folder);
      if (!current()) return;
      const elf = files[0] || '';
      // Clear stale paths as well, so a later quick-connect cannot flash a missing file.
      if (elf !== configured) workspace.saveSettings({ connection: { ...(workspace.settings.connection || {}), elf } });
      if (elf) {
        loadSymbols(elf);
        onDetected(elf, files.length);
      }
    } catch (error) {
      console.error('Could not detect workspace firmware', error);
    }
  };
}
