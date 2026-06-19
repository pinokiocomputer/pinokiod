const VOLATILE_CSI = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'P', 'S', 'T', 'X', '@', '`', 'd', 'e', 'f']);

class AnsiStreamTracker {
  constructor() {
    this.state = 'text';
    this.params = '';
    this.awaitingPrintable = false;
    this.stringAllowsBell = false;
  }

  markVolatile() {
    this.awaitingPrintable = true;
  }

  push(chunk = '') {
    if (!chunk || typeof chunk !== 'string') {
      return null;
    }
    let triggered = false;
    let reason;
    const setTriggered = (why) => {
      if (!reason) {
        reason = why;
      }
      triggered = true;
    };

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (this.state === 'text') {
        if (ch === '\u001b') {
          this.state = 'esc';
        } else if (ch === '\r' || ch === '\b') {
          this.markVolatile();
        } else if (ch === '\n') {
          this.awaitingPrintable = false;
        } else if (ch > ' ' && ch !== '\u007f') {
          if (this.awaitingPrintable) {
            this.awaitingPrintable = false;
            setTriggered('line-rewrite');
          }
        }
        continue;
      }

      if (this.state === 'esc') {
        if (ch === '[') {
          this.state = 'csi';
          this.params = '';
        } else if (ch === ']') {
          this.state = 'osc';
          this.stringAllowsBell = true;
        } else if ('PX^_'.includes(ch)) {
          this.state = 'osc';
          this.stringAllowsBell = false;
        } else {
          if ('78MDE'.includes(ch)) {
            this.markVolatile();
          }
          this.state = 'text';
        }
        continue;
      }

      if (this.state === 'osc') {
        if (this.stringAllowsBell && ch === '\u0007') {
          this.state = 'text';
          this.stringAllowsBell = false;
        } else if (ch === '\u001b') {
          this.state = 'osc_esc';
        }
        continue;
      }

      if (this.state === 'osc_esc') {
        if (ch === '\\') {
          this.state = 'text';
          this.stringAllowsBell = false;
        } else {
          this.state = 'osc';
        }
        continue;
      }

      if (this.state === 'csi') {
        if (ch === '\u001b') {
          this.state = 'esc';
          continue;
        }
        if (ch >= '@' && ch <= '~') {
          const finalChar = ch;
          const params = this.params;
          if ((finalChar === 'h' || finalChar === 'l') && params.includes('2026')) {
            setTriggered('decsync');
            this.awaitingPrintable = false;
          } else if (VOLATILE_CSI.has(finalChar)) {
            this.markVolatile();
          }
          this.state = 'text';
          this.params = '';
        } else {
          this.params += ch;
        }
        continue;
      }
    }

    if (triggered) {
      return { reason: reason || 'line-rewrite' };
    }
    return null;
  }
}

module.exports = AnsiStreamTracker;
