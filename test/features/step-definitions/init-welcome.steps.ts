import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { showWelcomeScreen } from '../../../src/ui/welcome-screen.js';

interface InitWelcomeWorld {
  terminalWidth?: number;
  welcomeOutput?: string;
}

function restoreOwnProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

Given('an interactive terminal {int} columns wide', function (
  this: InitWelcomeWorld,
  columns: number
) {
  this.terminalWidth = columns;
});

When('I show the init welcome screen', async function (this: InitWelcomeWorld) {
  assert.ok(this.terminalWidth, 'terminalWidth must be set by the terminal width step');

  const { stdin, stdout } = process;
  const originalNoColor = process.env.NO_COLOR;
  const stdinWasPaused = stdin.isPaused();
  const originalProperties = {
    stdoutWrite: Object.getOwnPropertyDescriptor(stdout, 'write'),
    stdoutIsTTY: Object.getOwnPropertyDescriptor(stdout, 'isTTY'),
    stdoutColumns: Object.getOwnPropertyDescriptor(stdout, 'columns'),
    stdinIsTTY: Object.getOwnPropertyDescriptor(stdin, 'isTTY'),
    stdinSetRawMode: Object.getOwnPropertyDescriptor(stdin, 'setRawMode'),
  };
  let output = '';
  let enterTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    delete process.env.NO_COLOR;
    Object.defineProperties(stdout, {
      write: {
        configurable: true,
        value: (chunk: string | Uint8Array) => {
          output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
          return true;
        },
      },
      isTTY: { configurable: true, value: true },
      columns: { configurable: true, value: this.terminalWidth },
    });
    Object.defineProperties(stdin, {
      isTTY: { configurable: true, value: true },
      setRawMode: { configurable: true, value: () => stdin },
    });

    enterTimer = setTimeout(() => stdin.emit('data', Buffer.from('\r')), 300);
    await showWelcomeScreen();
  } finally {
    if (enterTimer) clearTimeout(enterTimer);
    this.welcomeOutput = output;
    restoreOwnProperty(stdout, 'write', originalProperties.stdoutWrite);
    restoreOwnProperty(stdout, 'isTTY', originalProperties.stdoutIsTTY);
    restoreOwnProperty(stdout, 'columns', originalProperties.stdoutColumns);
    restoreOwnProperty(stdin, 'isTTY', originalProperties.stdinIsTTY);
    restoreOwnProperty(stdin, 'setRawMode', originalProperties.stdinSetRawMode);
    if (stdinWasPaused) stdin.pause();
    else stdin.resume();
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  }
});

Then('the welcome output contains {string} once', function (
  this: InitWelcomeWorld,
  expected: string
) {
  assert.notEqual(this.welcomeOutput, undefined, 'welcomeOutput must be captured by the welcome step');
  assert.equal(this.welcomeOutput.match(new RegExp(expected, 'gu'))?.length ?? 0, 1);
});

Then('the welcome output emits no cursor-up animation', function (this: InitWelcomeWorld) {
  assert.notEqual(this.welcomeOutput, undefined, 'welcomeOutput must be captured by the welcome step');
  assert.doesNotMatch(this.welcomeOutput, /\u001b\[\d+A/u);
});
