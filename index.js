const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.g0ilve4.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    // db collections
    const db = client.db("club-nest-db");
    const usersCollection = db.collection("users");
    const clubManagersCollection = db.collection("clubManager");
    const clubsCollection = db.collection("clubs");

    // user related apis
    app.post("/user", async (req, res) => {
      const user = req.body;
      user.role = "member";
      user.createdAt = new Date();
      const email = user.email;
      const existingUser = await usersCollection.findOne({ email });
      if (existingUser) {
        return res.send({ message: "user already exist" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users',async(req,res)=>{
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "member" });
    });

    app.patch("/user/:id", async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedInfo = {
        $set: {
          role: status,
        },
      };
      const result = await usersCollection.updateOne(query, updatedInfo);

      // update user role to admin
      if (status === "admin") {
        const email = req.body.email;
        const managerQuery = { email };
        const updateUserInfo = {
          $set: {
            role: "admin",
          },
        };
        const userResult = await usersCollection.updateOne(
          managerQuery,
          updateUserInfo
        );
        res.send(userResult)
      }

      // update user role to member
      if (status === "member") {
        const email = req.body.email;
        const managerQuery = { email };
        const updateUserInfo = {
          $set: {
            role: "member",
          },
        };
        const userResult = await usersCollection.updateOne(
          managerQuery,
          updateUserInfo
        );
        res.send(userResult)
      }

      res.send(result);
    });

    //  club related apis
    app.post("/addClub", async (req, res) => {
      const clubData = req.body;
      clubData.status = "pending";
      const memberShipFee = clubData.memberShipFee;
      clubData.memberShipFee = Number(memberShipFee);
      clubData.createdAt = new Date();
      const result = await clubsCollection.insertOne(clubData);
      res.send(result);
    });

    app.get("/clubs", async (req, res) => {
      const email = req.query.email;
      const status = req.query.status
      const query = {};
      if (email) {
        query.managerEmail = email;
      }

      if(status){
        query.status = status
      }
      const result = await clubsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await clubsCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/club/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await clubsCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/clubEdit/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedClubInfo = req.body;
      updatedClubInfo.status = "pending";
      const memberShipFee = updatedClubInfo.memberShipFee;
      updatedClubInfo.memberShipFee = Number(memberShipFee);
      const update = {
        $set: updatedClubInfo,
      };
      const result = await clubsCollection.updateOne(query, update);
      res.send(result);
    });

    app.patch("/clubStatus/:id", async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updateStatus = {
        $set: {
          status: status,
        },
      };
      const result = await clubsCollection.updateOne(query, updateStatus);
      res.send(result);
    });

    // club manager related apis
    app.post("/clubManager", async (req, res) => {
      const clubManagerInfo = req.body;
      clubManagerInfo.status = "pending";
      clubManagerInfo.createdAt = new Date();

      const email = clubManagerInfo.email;
      const alreadyRequested = await clubManagersCollection.findOne({ email });
      if (alreadyRequested) {
        return res.send({
          message: "you have already requested,wait for approve",
        });
      }
      const result = await clubManagersCollection.insertOne(clubManagerInfo);
      res.send(result);
    });

    app.get("/getClubManager", async (req, res) => {
      const result = await clubManagersCollection.find().toArray();
      res.send(result);
    });

    app.patch("/clubManager/:id", async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedInfo = {
        $set: {
          status: status,
        },
      };
      const result = await clubManagersCollection.updateOne(query, updatedInfo);

      // update user role to club manager
      if (status === "approved") {
        const email = req.body.email;
        const managerQuery = { email };
        const updateUserInfo = {
          $set: {
            role: "Club-Manager",
          },
        };
        const userResult = await usersCollection.updateOne(
          managerQuery,
          updateUserInfo
        );
        res.send(userResult)
      }

      // update user role to member
      if (status === "rejected") {
        const email = req.body.email;
        const managerQuery = { email };
        const updateUserInfo = {
          $set: {
            role: "member",
          },
        };
        const userResult = await usersCollection.updateOne(
          managerQuery,
          updateUserInfo
        );
        res.send(userResult)
      }

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
