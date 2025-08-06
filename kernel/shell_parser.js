class ShellParser {
  constructor() {
    this.buffer = '';
    this.bufferMaxSize = 2000;
    this.lastNotificationTime = 0;
    this.debounceMs = 1000; // Prevent spam
  }

  /**
   * Process terminal data and detect notification patterns
   * @param {string} data - Raw terminal data chunk
   * @returns {Array} Array of notification objects or empty array
   */
  processData(data) {
    // Add to buffer
    this.buffer += data;
    
    // Keep buffer manageable
    if (this.buffer.length > this.bufferMaxSize) {
      this.buffer = this.buffer.slice(-this.bufferMaxSize);
    }

    const notifications = [];
    
    // Check for each pattern type
//    notifications.push(...this.detectBell(data));
    notifications.push(...this.detectEscapeSequences(data));
//    notifications.push(...this.detectTextPatterns(this.buffer));
    
    // Apply debouncing and return
    return this.debounceNotifications(notifications);
  }

  /**
   * Detect bell character (ASCII 7)
   */
  detectBell(data) {
    const notifications = [];
    if (data.includes('\x07')) {
      notifications.push({
        type: 'bell',
        title: 'Terminal Bell',
        message: 'Bell character detected',
        timestamp: Date.now()
      });
    }
    return notifications;
  }

  /**
   * Detect iTerm2-style escape sequences
   * Format: \x1b]9;[title];[message]\x07
   */
  //detectEscapeSequences(data) {
  //  const notifications = [];
  //  
  //  // iTerm2 notification escape sequence
  //  const escapeRegex = /\x1b\]9;([^;]*);?([^\x07]*)\x07/g;
  //  let match;
  //  
  //  while ((match = escapeRegex.exec(data)) !== null) {
  //    notifications.push({
  //      type: 'escape_sequence',
  //      title: match[1] || 'Terminal Notification',
  //      message: match[2] || 'Notification from terminal',
  //      timestamp: Date.now()
  //    });
  //  }

  //  // Generic OSC (Operating System Command) sequences
  //  const oscRegex = /\x1b\]([0-9]+);([^\x07\x1b]*)\x07/g;
  //  while ((match = oscRegex.exec(data)) !== null) {
  //    if (match[1] === '9') { // Notification OSC
  //      notifications.push({
  //        type: 'osc_notification',
  //        title: 'System Notification',
  //        message: match[2] || 'OSC notification',
  //        timestamp: Date.now()
  //      });
  //    }
  //  }

  //  return notifications;
  //}
  detectEscapeSequences(data) {
    const notifications = [];
    
    // OSC 9 - Notification sequences (used by iTerm2 and others)
    const notificationRegex = /\x1b\]9;([^;]*);?([^\x07]*)\x07/g;
    let match;
    
    while ((match = notificationRegex.exec(data)) !== null) {
      notifications.push({
        type: 'notification_escape',
        title: match[1] || 'Terminal Notification',
        message: match[2] || 'Notification from terminal',
        timestamp: Date.now()
      });
    }

    // Other OSC sequences (window title, etc.) - usually not notifications
    const otherOscRegex = /\x1b\]([0-8]|[1-9][0-9]+);([^\x07\x1b]*)\x07/g;
    while ((match = otherOscRegex.exec(data)) !== null) {
      // Only log these for debugging, don't treat as notifications
      console.debug(`OSC ${match[1]}: ${match[2]}`);
    }

    return notifications;
  }

  /**
   * Detect text patterns that might indicate notifications
   */
  detectTextPatterns(buffer) {
    const notifications = [];
    
    const patterns = [
      {
        regex: /\b(?:alert|notification|notify|attention)\b[^\n\r]*$/im,
        type: 'text_alert',
        title: 'Alert Detected',
        extractMessage: true
      },
      {
        regex: /\berror\b[^\n\r]*$/im,
        type: 'error',
        title: 'Error Detected',
        extractMessage: true
      },
      {
        regex: /\b(?:completed|finished|done|success)\b[^\n\r]*$/im,
        type: 'completion',
        title: 'Task Complete',
        extractMessage: true
      },
      {
        regex: /claude\s+code.*?(?:completed|finished|ready|done)[^\n\r]*$/im,
        type: 'claude_code',
        title: 'Claude Code',
        extractMessage: true
      },
      {
        regex: /✅[^\n\r]*$/im,
        type: 'success_emoji',
        title: 'Success',
        extractMessage: true
      },
      {
        regex: /❌[^\n\r]*$/im,
        type: 'error_emoji', 
        title: 'Error',
        extractMessage: true
      },
      {
        regex: /🔔[^\n\r]*$/im,
        type: 'notification_emoji',
        title: 'Notification',
        extractMessage: true
      }
    ];

    patterns.forEach(pattern => {
      const match = buffer.match(pattern.regex);
      if (match) {
        let message = pattern.extractMessage ? 
          match[0].trim().slice(0, 100) : 
          `${pattern.title} detected`;
        
        // Clean up ANSI escape codes from message
        message = this.stripAnsiCodes(message);
        
        notifications.push({
          type: pattern.type,
          title: pattern.title,
          message: message,
          timestamp: Date.now(),
          rawMatch: match[0]
        });
      }
    });

    return notifications;
  }

  /**
   * Remove ANSI escape codes from text
   */
  stripAnsiCodes(text) {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Apply debouncing to prevent notification spam
   */
  debounceNotifications(notifications) {
    const now = Date.now();
    if (notifications.length > 0 && (now - this.lastNotificationTime) > this.debounceMs) {
      this.lastNotificationTime = now;
      return notifications;
    }
    return [];
  }

  /**
   * Reset the internal state
   */
  reset() {
    this.buffer = '';
    this.lastNotificationTime = 0;
  }

  /**
   * Add custom pattern
   */
  addCustomPattern(regex, type, title) {
    // This would require refactoring detectTextPatterns to use a dynamic array
    // For now, patterns are hardcoded above
  }
}

// Usage example:
/*
const detector = new TerminalNotificationDetector();

// Simulate terminal data chunks
const testData = [
  'Running command...\n',
  'Alert: Process completed successfully\x07',
  '\x1b]9;Claude Code;File created successfully\x07',
  'Error: File not found\n',
  '✅ Build completed\n'
];

testData.forEach(chunk => {
  const notifications = detector.processData(chunk);
  notifications.forEach(notif => {
    console.log(`[${notif.type}] ${notif.title}: ${notif.message}`);
  });
});
*/
module.exports = ShellParser

// Example integration with node-pty:
/*
const pty = require('node-pty');
const detector = new TerminalNotificationDetector();

const ptyProcess = pty.spawn('bash', [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.cwd(),
  env: process.env
});

ptyProcess.on('data', (data) => {
  // Forward to stdout
  process.stdout.write(data);
  
  // Check for notifications
  const notifications = detector.processData(data);
  notifications.forEach(notif => {
    console.log(`\n🔔 [${notif.type}] ${notif.title}: ${notif.message}\n`);
    // Here you could send to notification system, websocket, etc.
  });
});
*/
