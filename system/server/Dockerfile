FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server ./server
COPY extension ./extension
COPY public ./public
ENV PORT=8080
ENV CASTMIR_DATA=/app/server/data
EXPOSE 8080
CMD ["node", "server/server.js"]
