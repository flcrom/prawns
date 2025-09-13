const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');
const retrieveHashesByPrefix = require("./retriveHashes");
const client = require("./client")

function createSha1Hash(input) {
  const hash = crypto.createHash('sha1');
  hash.update(input);
  return hash.digest('hex');
}

async function processLineAndStoreInRedis(line) {
  const originalString = line.trim();
  if (!originalString) {
    return;
  }

  const hash = createSha1Hash(originalString);
  const key = hash.slice(0, 3);
  const value = hash; 
  
  try {
    await client.RPUSH(key, value);
  } catch (err) {
    console.error(`Error storing data for key "${key}":`, err);
  }
}



async function main() {
    await client.FLUSHDB();
    console.log("Starting to process the rockyou.txt file and store hashes in Redis...");

    
    const fileStream = fs.createReadStream('./database/rockyou.txt', { encoding: 'latin1' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    
    let linesProcessed = 0;

    rl.on('line', (line) => {
        processLineAndStoreInRedis(line);
        linesProcessed++;
        if (linesProcessed >= 1000000) rl.close();
    });

    rl.on('close', async () => {
        console.log(`Finished processing ${linesProcessed} lines.`);
        console.log("Finished storing data in Redis.");
        
        const testPrefix = '000';
        const hashes = await retrieveHashesByPrefix(testPrefix);
        console.log(hashes)

        console.log('Disconnected from Redis.');
    });
}

main();