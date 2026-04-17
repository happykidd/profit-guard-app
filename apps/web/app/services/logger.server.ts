type LogLevel = "INFO" | "WARN" | "ERROR";

type LogContext = Record<string, unknown>;

function toSerializableContext(context?: LogContext) {
  if (!context) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(context)) as LogContext;
}

function writeLog(level: LogLevel, scope: string, event: string, context?: LogContext) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    event,
    context: toSerializableContext(context),
  };

  const line = JSON.stringify(payload);

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  if (level === "WARN") {
    console.warn(line);
    return;
  }

  console.info(line);
}

export function createLogger(scope: string) {
  return {
    info(event: string, context?: LogContext) {
      writeLog("INFO", scope, event, context);
    },
    warn(event: string, context?: LogContext) {
      writeLog("WARN", scope, event, context);
    },
    error(event: string, context?: LogContext) {
      writeLog("ERROR", scope, event, context);
    },
  };
}
