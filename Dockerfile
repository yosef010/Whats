FROM node:18-alpine

# تثبيت git المطلوب من مكتبة Baileys
RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]
