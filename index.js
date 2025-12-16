const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);

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

// firebase token
const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function run() {
  try {
    // await client.connect();

    // db collections
    const db = client.db("club-nest-db");
    const usersCollection = db.collection("users");
    const clubManagersCollection = db.collection("clubManager");
    const clubsCollection = db.collection("clubs");
    const membershipCollection = db.collection("membership");
    const paymentsCollection = db.collection("payments");
    const eventsCollection = db.collection("events");
    const eventRegistrationCollection = db.collection("eventRegistration");

    // middleware for security
    const firebaseToken = async (req, res, next) => {
      const token = req.headers.authorization;
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      try {
        const tokenId = token.split(" ")[1];
        const decode = await admin.auth().verifyIdToken(tokenId);
        req.decoded_email = decode.email;
      } catch (err) {}
      next();
    };

    // admin middle ware for vverfiying admin
    const adminVerify = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    // club manager middle ware for verfiying club Manager
    const clubManagerVerify = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "Club-Manager") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

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

    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "member" });
    });

    app.patch("/user/:id", adminVerify, async (req, res) => {
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
        res.send(userResult);
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
        res.send(userResult);
      }

      res.send(result);
    });

    // membership related apis
    app.post("/addMembership", async (req, res) => {
      const membershipInfo = req.body;
      membershipInfo.createdAt = new Date();

      if (membershipInfo.clubFee === 0) {
        membershipInfo.status = "pending join";
      } else {
        membershipInfo.status = "pendingPayment";
      }
      const result = await membershipCollection.insertOne(membershipInfo);
      res.send(result);
    });

    app.get("/membershipGet", firebaseToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.memberEmail = email;
      }
      const result = await membershipCollection.find(query).toArray();
      res.send(result);
    });

    app.patch(
      "/updateMembershipStatus/:id",
      clubManagerVerify,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const status = req.body.status;
        const updateStatus = {
          $set: {
            status: status,
          },
        };
        const result = await membershipCollection.updateOne(
          query,
          updateStatus
        );
        res.send(result);
      }
    );

    // payment related apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.clubFee) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: `Please pay for: ${paymentInfo.clubName}`,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          clubId: paymentInfo.clubId,
          clubName: paymentInfo.clubName,
          memberId: paymentInfo.memberId,
        },
        customer_email: paymentInfo.memberEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
      });

      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      console.log(transactionId);
      const existingPayment = await paymentsCollection.findOne(query);
      console.log(existingPayment);
      if (existingPayment) {
        return res.send({
          message: "aleardy exist",
          transactionId,
        });
      }

      if (session.payment_status === "paid") {
        const clubId = session.metadata.clubId;
        const memberId = session.metadata.memberId;
        const query = { _id: new ObjectId(clubId) };
        const update = {
          $inc: { membersCount: 1 },
        };
        const result = await clubsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          memberEmail: session.customer_email,
          clubId: session.metadata.clubId,
          clubName: session.metadata.clubName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          PaidAt: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(payment);

        const updateMembershipStatus = {
          $set: {
            status: "active",
          },
        };

        const memberQuery = { _id: new ObjectId(memberId) };
        const membershipResult = await membershipCollection.updateOne(
          memberQuery,
          updateMembershipStatus
        );

        return res.send({
          success: true,
          clubId: session.metadata.clubId,
          clubName: session.metadata.clubName,
          amount: session.amount_total / 100,
          transactionId: session.payment_intent,
          paymentInfo: paymentResult,
        });
      }

      return res.send({ success: false });
    });

    app.patch("/freeJoin", async (req, res) => {
      const clubId = req.body.clubId;
      const memberId = req.body.memberId;
      const query = { _id: new ObjectId(clubId) };
      const update = {
        $inc: { membersCount: 1 },
      };
      const result = await clubsCollection.updateOne(query, update);

      const updateMembershipStatus = {
        $set: {
          status: "active",
        },
      };

      const memberQuery = { _id: new ObjectId(memberId) };
      const membershipResult = await membershipCollection.updateOne(
        memberQuery,
        updateMembershipStatus
      );

      res.send(membershipResult, result);
    });

    app.get("/payments", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.memberEmail = email;
      }

      const result = await paymentsCollection.find(query).toArray();
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
      const status = req.query.status;
      const query = {};
      if (email) {
        query.managerEmail = email;
      }

      if (status) {
        query.status = status;
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

    app.get("/filteredClubs", async (req, res) => {
      const { clubType, search } = req.query;

      let query = { status: "approved" };

      if (clubType && clubType !== "all") {
        query.category = { $regex: clubType, $options: "i" };
      }

      if (search) {
        query.clubName = { $regex: search, $options: "i" };
      }

      const result = await clubsCollection.find(query).toArray();
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
        res.send(userResult);
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
        res.send(userResult);
      }

      res.send(result);
    });

    // event related apis
    app.post("/addEvent", async (req, res) => {
      const eventData = req.body;
      const clubId = eventData.clubId;
      eventData.createdAt = new Date();
      eventData.eventDate = new Date(eventData.eventDate);
      const result = await eventsCollection.insertOne(eventData);
      const query = { _id: new ObjectId(clubId) };
      const update = {
        $inc: { eventsCount: 1 },
      };
      const updateresult = await clubsCollection.updateOne(query, update);
      res.send(result);
    });

    app.get("/getEvents", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.clubEmail = email;
      }
      const result = await eventsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/getEvent/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await eventsCollection.find(query).toArray();
      res.send(result);
    });

    app.patch("/editEvent/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const eventData = req.body;
      eventData.eventDate = new Date(eventData.eventDate);
      const update = {
        $set: eventData,
      };
      const result = await eventsCollection.updateOne(query, update);
      console.log(result);
      res.send(result);
    });

    app.delete("/deleteEvent/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await eventsCollection.deleteOne(query);
      res.send(result);
    });

    app.post("/addEventRegistration", async (req, res) => {
      const eventData = req.body;
      eventData.registeredAt = new Date();
      const result = await eventRegistrationCollection.insertOne(eventData);
      res.send(result);
    });

    app.get("/getRegisteredEvents", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.userEmail = email;
      }
      const result = await eventRegistrationCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/cancelRegister/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await eventRegistrationCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/filteredEvents", async (req, res) => {
      const { category, search } = req.query;

      let query = {};

      if (category && category !== "all") {
        query.category = { $regex: category, $options: "i" };
      }

      if (search) {
        query.eventName = { $regex: search, $options: "i" };
      }

      const result = await eventsCollection.find(query).toArray();
      res.send(result);
    });

    // Admin Stats API
    app.get("/admin-stats", async (req, res) => {
      try {
        // Total events created
        const totalEvents = await eventsCollection
          .aggregate([
            { $group: { _id: null, count: { $sum: 1 } } },
            { $project: { _id: 0, totalEvents: "$count" } },
          ])
          .toArray();
        const totalEventsCount =
          totalEvents.length > 0 ? totalEvents[0].totalEvents : 0;

        // Total earnings from memberships (sum of paid amounts)
        const totalEarnings = await paymentsCollection
          .aggregate([
            { $match: { paymentStatus: "paid" } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
            { $project: { _id: 0, totalEarnings: "$total" } },
          ])
          .toArray();
        const totalEarningsAmount =
          totalEarnings.length > 0 ? totalEarnings[0].totalEarnings : 0;

        // Total clubs created
        const totalClubs = await clubsCollection
          .aggregate([
            { $group: { _id: null, count: { $sum: 1 } } },
            { $project: { _id: 0, totalClubs: "$count" } },
          ])
          .toArray();
        const totalClubsCount =
          totalClubs.length > 0 ? totalClubs[0].totalClubs : 0;

        // Total members (users with role "member")
        const totalMembers = await usersCollection
          .aggregate([
            { $match: { role: "member" } },
            { $group: { _id: null, count: { $sum: 1 } } },
            { $project: { _id: 0, totalMembers: "$count" } },
          ])
          .toArray();
        const totalMembersCount =
          totalMembers.length > 0 ? totalMembers[0].totalMembers : 0;

        // Daily earnings (sum for today)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dailyEarnings = await paymentsCollection
          .aggregate([
            {
              $match: {
                paymentStatus: "paid",
                PaidAt: { $gte: today, $lt: tomorrow },
              },
            },
            { $group: { _id: null, total: { $sum: "$amount" } } },
            { $project: { _id: 0, dailyEarnings: "$total" } },
          ])
          .toArray();
        const dailyAmount =
          dailyEarnings.length > 0 ? dailyEarnings[0].dailyEarnings : 0;

        // Weekly earnings (sum for last 7 days including today)
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // Last 7 days including today
        const weeklyEarnings = await paymentsCollection
          .aggregate([
            {
              $match: {
                paymentStatus: "paid",
                PaidAt: { $gte: sevenDaysAgo, $lt: tomorrow },
              },
            },
            { $group: { _id: null, total: { $sum: "$amount" } } },
            { $project: { _id: 0, weeklyEarnings: "$total" } },
          ])
          .toArray();
        const weeklyAmount =
          weeklyEarnings.length > 0 ? weeklyEarnings[0].weeklyEarnings : 0;

        // Return as array for frontend
        res.send([
          { status: "Total Clubs", count: totalClubsCount },
          { status: "Total Events", count: totalEventsCount },
          { status: "Total Members", count: totalMembersCount },
          { status: "Total Earnings", count: totalEarningsAmount },
          { status: "Daily Earnings", count: dailyAmount },
          { status: "Weekly Earnings", count: weeklyAmount },
        ]);
      } catch (error) {
        res.status(500).send({ message: "Error fetching admin stats", error });
      }
    });

    // Club Manager Stats API
    app.get(
      "/manager-stats",
      firebaseToken,
      clubManagerVerify,
      async (req, res) => {
        const email = req.decoded_email;
        try {
          // Total clubs created by this manager
          const totalClubs = await clubsCollection
            .aggregate([
              { $match: { managerEmail: email } },
              { $group: { _id: null, count: { $sum: 1 } } },
              { $project: { _id: 0, totalClubs: "$count" } },
            ])
            .toArray();
          const totalClubsCount =
            totalClubs.length > 0 ? totalClubs[0].totalClubs : 0;

          // Total events created by this manager (via clubEmail)
          const totalEvents = await eventsCollection
            .aggregate([
              { $match: { clubEmail: email } },
              { $group: { _id: null, count: { $sum: 1 } } },
              { $project: { _id: 0, totalEvents: "$count" } },
            ])
            .toArray();
          const totalEventsCount =
            totalEvents.length > 0 ? totalEvents[0].totalEvents : 0;

          // Get all clubIds managed by this email
          const managedClubs = await clubsCollection
            .find({ managerEmail: email })
            .toArray();
          const clubIds = managedClubs.map((club) => club._id.toString());

          // Total earnings from their clubs (sum of paid amounts for those clubIds)
          const totalEarnings = await paymentsCollection
            .aggregate([
              { $match: { clubId: { $in: clubIds }, paymentStatus: "paid" } },
              { $group: { _id: null, total: { $sum: "$amount" } } },
              { $project: { _id: 0, totalEarnings: "$total" } },
            ])
            .toArray();
          const totalEarningsAmount =
            totalEarnings.length > 0 ? totalEarnings[0].totalEarnings : 0;

          // Total members in their clubs (sum of membersCount from their clubs)
          const totalMembers = await clubsCollection
            .aggregate([
              { $match: { managerEmail: email } },
              { $group: { _id: null, total: { $sum: "$membersCount" } } },
              { $project: { _id: 0, totalMembers: "$total" } },
            ])
            .toArray();
          const totalMembersCount =
            totalMembers.length > 0 ? totalMembers[0].totalMembers : 0;

          res.send({
            totalClubs: totalClubsCount,
            totalEvents: totalEventsCount,
            totalEarnings: totalEarningsAmount,
            totalMembers: totalMembersCount,
          });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error fetching manager stats", error });
        }
      }
    );

    // Member Stats API
    app.get("/member-stats", firebaseToken, async (req, res) => {
      const email = req.decoded_email;
      try {
        // Total clubs joined (active memberships)
        const totalClubsJoined = await membershipCollection
          .aggregate([
            { $match: { memberEmail: email, status: "active" } },
            { $group: { _id: null, count: { $sum: 1 } } },
            { $project: { _id: 0, totalClubsJoined: "$count" } },
          ])
          .toArray();
        const totalClubsJoinedCount =
          totalClubsJoined.length > 0
            ? totalClubsJoined[0].totalClubsJoined
            : 0;

        // Total events registered (attended)
        const totalEventsAttended = await eventRegistrationCollection
          .aggregate([
            { $match: { userEmail: email } },
            { $group: { _id: null, count: { $sum: 1 } } },
            { $project: { _id: 0, totalEventsAttended: "$count" } },
          ])
          .toArray();
        const totalEventsAttendedCount =
          totalEventsAttended.length > 0
            ? totalEventsAttended[0].totalEventsAttended
            : 0;

        // Total money spent (sum of paid amounts)
        const totalSpent = await paymentsCollection
          .aggregate([
            { $match: { memberEmail: email, paymentStatus: "paid" } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
            { $project: { _id: 0, totalSpent: "$total" } },
          ])
          .toArray();
        const totalSpentAmount =
          totalSpent.length > 0 ? totalSpent[0].totalSpent : 0;

        res.send({
          totalClubsJoined: totalClubsJoinedCount,
          totalEventsAttended: totalEventsAttendedCount,
          totalSpent: totalSpentAmount,
        });
      } catch (error) {
        res.status(500).send({ message: "Error fetching member stats", error });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// app.listen(port, () => {
//   console.log(`Example app listening on port ${port}`);
// });
