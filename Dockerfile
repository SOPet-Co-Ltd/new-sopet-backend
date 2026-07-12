FROM node:22-alpine AS deps
WORKDIR /app
ENV HUSKY=0
COPY package.json yarn.lock ./
RUN apk add --no-cache python3 make g++ \
  && yarn install --frozen-lockfile \
  && apk del python3 make g++

FROM node:22-alpine AS build
WORKDIR /app
ENV HUSKY=0
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build \
  && yarn install --frozen-lockfile --production \
  && yarn cache clean

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN mkdir -p src && chown -R node:node /app
USER node
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json yarn.lock ./
EXPOSE 3002
CMD ["node", "dist/src/main.js"]
