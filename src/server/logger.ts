import fs from 'fs';
import path from 'path';

// ✅ Logger simple pour audit (sans dépendance externe)
class SimpleLogger {
  private logsDir = 'logs';

  constructor() {
    // Créer le répertoire logs s'il n'existe pas
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private formatDate(): string {
    return new Date().toISOString();
  }

  private writeLog(filename: string, level: string, message: string, data?: any): void {
    const timestamp = this.formatDate();
    const logEntry = {
      timestamp,
      level,
      message,
      ...(data && { data })
    };

    const logFile = path.join(this.logsDir, filename);
    const logLine = JSON.stringify(logEntry) + '\n';

    fs.appendFileSync(logFile, logLine, 'utf-8');

    // Log aussi en console en développement
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${level}] ${message}`, data || '');
    }
  }

  info(message: string, data?: any): void {
    this.writeLog('combined.log', 'INFO', message, data);
  }

  error(message: string, data?: any): void {
    this.writeLog('error.log', 'ERROR', message, data);
    this.writeLog('combined.log', 'ERROR', message, data);
  }

  warn(message: string, data?: any): void {
    this.writeLog('combined.log', 'WARN', message, data);
  }

  audit(action: string, userId: string, details?: any): void {
    const auditEntry = {
      action,
      userId,
      timestamp: this.formatDate(),
      ...details
    };
    this.writeLog('audit.log', 'AUDIT', action, auditEntry);
  }

  security(event: string, severity: string, details?: any): void {
    const securityEntry = {
      event,
      severity,
      timestamp: this.formatDate(),
      ...details
    };
    this.writeLog('security.log', 'SECURITY', event, securityEntry);
  }
}

export const logger = new SimpleLogger();
