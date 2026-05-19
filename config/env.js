function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

const config = {
  nodeEnv: NODE_ENV,
  port: process.env.PORT || 3000,

  jwtSecret: requireEnv('JWT_SECRET'),

  databasePath: process.env.DATABASE_PATH || './database/fileproof.db',

  shelbyApiKey:
    NODE_ENV === 'production'
      ? requireEnv('SHELBY_API_KEY')
      : process.env.SHELBY_API_KEY || '',

  shelbyBaseUrl:
    process.env.SHELBY_BASE_URL || 'https://api.shelby.xyz',

  maxFileSize: Number(process.env.MAX_FILE_SIZE || 100 * 1024 * 1024),
};

module.exports = config;
