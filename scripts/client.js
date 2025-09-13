const redis = require("redis");

const client = redis.createClient({
    url: 'redis://localhost:6379/1'
});

client.connect()
    .then(() => {
        console.log("connected to the redis db");
    })
    .catch((err) => {
        console.err("faiied to connect to the redis database", err);
    })

module.exports = client