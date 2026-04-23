#!/usr/bin/env node
import { Command } from 'commander';
import { listCommand } from './commands/list.js';
import { initToolCommand } from './commands/init-tool.js';
import { makeInstallSkillCommand } from './commands/install-skill.js';

const program = new Command();

program
  .name('wyreup')
  .description('Wyreup CLI — wire up your tools from the shell')
  .version('0.0.0');

program
  .command('list')
  .description('List available tools')
  .action(() => {
    listCommand();
  });

program
  .command('init-tool')
  .description('Scaffold a new ToolModule into the monorepo')
  .action(async () => {
    await initToolCommand();
  });

program.addCommand(makeInstallSkillCommand());

program.parse();
