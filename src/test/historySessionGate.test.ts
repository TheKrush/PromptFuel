import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldStartHistorySession } from '../providers/historySessionGate';

describe('shouldStartHistorySession', () => {
  it('starts when no session has ever run', () => {
    assert.equal(shouldStartHistorySession({
      runningStatus: undefined,
      runningDirPath: undefined,
      requestedDirPath: 'C:\\projects'
    }), true);
  });

  it('does not restart a running session for the same root', () => {
    assert.equal(shouldStartHistorySession({
      runningStatus: 'running',
      runningDirPath: 'C:\\projects',
      requestedDirPath: 'C:\\projects'
    }), false, 'a same-root refresh burst must let the in-flight staged scan finish');
  });

  it('starts a fresh session when the source root changed while one was running', () => {
    assert.equal(shouldStartHistorySession({
      runningStatus: 'running',
      runningDirPath: 'C:\\projects-old',
      requestedDirPath: 'C:\\projects-new'
    }), true, 'a source-root change must supersede immediately, even mid-scan');
  });

  it('starts a fresh session once the previous one completed', () => {
    assert.equal(shouldStartHistorySession({
      runningStatus: 'completed',
      runningDirPath: 'C:\\projects',
      requestedDirPath: 'C:\\projects'
    }), true);
  });

  it('starts a fresh session after an error', () => {
    assert.equal(shouldStartHistorySession({
      runningStatus: 'error',
      runningDirPath: 'C:\\projects',
      requestedDirPath: 'C:\\projects'
    }), true);
  });

  it('starts a fresh session if the previously tracked session was superseded', () => {
    assert.equal(shouldStartHistorySession({
      runningStatus: 'superseded',
      runningDirPath: 'C:\\projects',
      requestedDirPath: 'C:\\projects'
    }), true);
  });
});
