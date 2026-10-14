import net from "node:net";

// Minimal in-process SMTP server for tests: records commands and the last message body.
export function fakeSmtpServer() {
  const received = { commands: [], data: "" };
  const server = net.createServer((socket) => {
    let inData = false;
    let buffer = "";
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (inData) {
        if (buffer.includes("\r\n.\r\n")) {
          received.data = buffer.split("\r\n.\r\n")[0];
          buffer = "";
          inData = false;
          socket.write("250 queued\r\n");
        }
        return;
      }
      let index;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        received.commands.push(line);
        if (/^EHLO|^HELO/i.test(line)) socket.write("250 fake\r\n");
        else if (/^MAIL FROM|^RCPT TO/i.test(line)) socket.write("250 ok\r\n");
        else if (/^DATA/i.test(line)) { inData = true; socket.write("354 go\r\n"); break; }
        else if (/^QUIT/i.test(line)) { socket.write("221 bye\r\n"); socket.end(); }
        else socket.write("250 ok\r\n");
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, received, port: server.address().port }))
  );
}
