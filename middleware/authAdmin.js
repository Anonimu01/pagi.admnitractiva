const jwt = require("jsonwebtoken");

module.exports = async (req, res, next) => {
try {

```
const token =
  req.headers.authorization?.split(" ")[1];

if (!token) {
  return res.status(401).json({
    msg: "No token"
  });
}

const decoded = jwt.verify(
  token,
  process.env.JWT_SECRET
);

if (!decoded) {
  return res.status(401).json({
    msg: "Invalid token"
  });
}

req.user = decoded;

next();
```

} catch (err) {
console.error(err);

```
return res.status(401).json({
  msg: "Auth error"
});
```

}
};
