import { createLogger, format, transports } from 'winston';

const { combine, timestamp, json, errors, printf, colorize } = format;

// Custom format for development
const devFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  if (stack) {
    msg += `\n${stack}`;
  }
  return msg;
});

// Determine log level
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Create logger instance
const logger = createLogger({
  level: logLevel,
  defaultMeta: {
    service: 'ticketai-backend',
    environment: process.env.NODE_ENV || 'development',
  },
  format: combine(
    timestamp(),
    errors({ stack: true })
  ),
  transports: [],
});

// Add console transport with appropriate formatting
if (process.env.NODE_ENV === 'production') {
  // Production: JSON format for log aggregation
  logger.add(new transports.Console({
    format: combine(
      json()
    )
  }));
} else {
  // Development: Pretty printed format
  logger.add(new transports.Console({
    format: combine(
      colorize(),
      devFormat
    )
  }));
}

// Add file transport in production
if (process.env.NODE_ENV === 'production' && process.env.LOG_FILE) {
  logger.add(new transports.File({
    filename: process.env.LOG_FILE,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }));
}

// Stream for Morgan HTTP logging integration
export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export default logger;
