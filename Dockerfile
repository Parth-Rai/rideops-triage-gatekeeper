# Stage 1: Build React Frontend
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Production Node + Express Server
FROM node:20-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY data/ /app/data/
COPY --from=client-builder /app/client/build ./public

ENV NODE_ENV=production
ENV CSV_PATH=/app/data/rideops_support_tickets.csv
EXPOSE 5000

CMD ["npm", "start"]