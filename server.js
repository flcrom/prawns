const express = require("express");
const crypto = require("crypto");
const retriveHashes = require("./scripts/retriveHashes");
const app = express();


function getSHA1(key) {
    const hash = crypto.createHash('sha1');
    hash.update(key);
    return hash.digest('hex');

}

app.use(express.json());
app.use(express.urlencoded({extended: true}));


app.get('/', (req, res) => {
    res.send("this is the prawns frontend");
})

app.post('/checkPass', async (req, res) => {
    if (!req.body.password) {
        res.send("please include your password");
    } else {
        const prefix = getSHA1(req.body.password);
        console.log("the SHA1 prefix of the password is: ", prefix);
        const key = prefix.slice(0,3);
        console.log("the key to be searched in the DB: ", key);
        const hashes = await retriveHashes(key);
        console.log("list of hashes with the same prefix: \n", hashes);
        for (const hash of hashes) {
            if (hash == prefix) {
                res.send("YOUR PASSWORD HAS APPEARED IN A DATA LEAK")
                return;
            }
        }

        res.send("THE PASSWORD HAS NOT APPEARD IN ANY DATA LEAK");
    }
})

app.listen('3000', ()=> {
    console.log("hi, the server is running");
})