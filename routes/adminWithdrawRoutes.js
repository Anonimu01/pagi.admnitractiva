
const express = require("express");
const router = express.Router();

const Withdraw = require("../models/Withdraw");
const User = require("../models/User");

const authAdmin = require("../middleware/authAdmin");

/* =========================================================
GET USER WITHDRAWS
========================================================= */
router.get("/withdraws/:id", authAdmin, async (req, res) => {
try {

```
const withdraws = await Withdraw.find({
  userId: req.params.id
}).sort({ createdAt: -1 });

return res.json(withdraws);
```

} catch (err) {
console.error(err);

```
return res.status(500).json({
  msg: "Error loading withdraws"
});
```

}
});

/* =========================================================
APPROVE WITHDRAW
========================================================= */
router.post("/withdraw/approve", authAdmin, async (req, res) => {
try {

```
const { id } = req.body;

const withdraw = await Withdraw.findById(id);

if (!withdraw) {
  return res.status(404).json({
    msg: "Withdraw not found"
  });
}

if (withdraw.status !== "pending") {
  return res.status(400).json({
    msg: "Withdraw already processed"
  });
}

withdraw.status = "approved";

await withdraw.save();

return res.json({
  success: true,
  msg: "Withdraw approved"
});
```

} catch (err) {
console.error(err);

```
return res.status(500).json({
  msg: "Error approving withdraw"
});
```

}
});

/* =========================================================
REJECT WITHDRAW
========================================================= */
router.post("/withdraw/reject", authAdmin, async (req, res) => {
try {

```
const { id } = req.body;

const withdraw = await Withdraw.findById(id);

if (!withdraw) {
  return res.status(404).json({
    msg: "Withdraw not found"
  });
}

if (withdraw.status !== "pending") {
  return res.status(400).json({
    msg: "Withdraw already processed"
  });
}

withdraw.status = "rejected";

await withdraw.save();

return res.json({
  success: true,
  msg: "Withdraw rejected"
});
```

} catch (err) {
console.error(err);

```
return res.status(500).json({
  msg: "Error rejecting withdraw"
});
```

}
});

module.exports = router;
