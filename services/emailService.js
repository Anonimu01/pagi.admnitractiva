const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail({ to, subject, html }) {
  if (!to) return;

  try {
    await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to,
      subject,
      html,
    });

    console.log("✅ Email enviado:", subject);
  } catch (err) {
    console.error("❌ Error enviando email:", err.message);
  }
}

/* ======================================================
   WITHDRAW EMAILS
====================================================== */

async function sendWithdrawEmailNotification({
  user,
  status,
  amount,
  adminNote = "",
}) {
  if (!user?.email) return;

  let title = "";
  let message = "";

  if (status === "approved") {
    title = "Retiro aprobado";
    message = `
      <h2>Tu retiro fue aprobado</h2>
      <p>Monto: $${amount}</p>
      <p>${adminNote || ""}</p>
    `;
  }

  if (status === "rejected") {
    title = "Retiro rechazado";
    message = `
      <h2>Tu retiro fue rechazado</h2>
      <p>Monto: $${amount}</p>
      <p>${adminNote || ""}</p>
    `;
  }

  if (status === "counter") {
    title = "Contraoferta de retiro";
    message = `
      <h2>Recibiste una contraoferta</h2>
      <p>Monto propuesto: $${amount}</p>
      <p>${adminNote || ""}</p>
    `;
  }

  await sendEmail({
    to: user.email,
    subject: title,
    html: message,
  });
}

/* ======================================================
   DOCUMENT EMAILS
====================================================== */

async function sendDocumentEmailNotification({
  user,
  status,
  type,
  adminNote = "",
}) {
  if (!user?.email) return;

  const subject =
    status === "approved"
      ? "Documento aprobado"
      : "Documento rechazado";

  const html = `
    <h2>${subject}</h2>
    <p>Documento: ${type}</p>
    <p>${adminNote}</p>
  `;

  await sendEmail({
    to: user.email,
    subject,
    html,
  });
}

/* ======================================================
   CLIENT MESSAGE EMAIL
====================================================== */

async function sendClientMessageNotification({
  user,
  subject,
  message,
}) {
  if (!user?.email) return;

  await sendEmail({
    to: user.email,
    subject,
    html: `
      <h2>${subject}</h2>
      <p>${message}</p>
    `,
  });
}

module.exports = {
  sendEmail,
  sendWithdrawEmailNotification,
  sendDocumentEmailNotification,
  sendClientMessageNotification,
};
