const client = require("./client")

async function retrieveHashesByPrefix(key) {
    try {
      return await client.LRANGE(key, 0, -1);
    } catch (err) {
      console.error(`Error retrieving data for key "${key}":`, err);
    }
}


  module.exports = retrieveHashesByPrefix;