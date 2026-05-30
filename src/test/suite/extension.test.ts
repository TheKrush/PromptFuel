import * as assert from 'assert';
import * as vscode from 'vscode';

suite('PromptFuel Extension', () => {
  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('thekrush.prompt-fuel'));
  });

  test('Should register all PromptFuel commands', async () => {
    const commands = await vscode.commands.getCommands();
    const expected = [
      'promptFuel.openDashboard',
      'promptFuel.refresh',
      'promptFuel.openDataFolder',
    ];
    for (const cmd of expected) {
      assert.ok(commands.includes(cmd), `Command ${cmd} not registered`);
    }
  });
});
