FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY awx-form.html database.js login.html server.js submissions.html .

EXPOSE 3000

CMD ["node", "server.js"] 
