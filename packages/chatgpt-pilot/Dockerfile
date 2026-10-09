FROM node@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7
WORKDIR /app
COPY packages/chatgpt-pilot/runtime/package.json packages/chatgpt-pilot/runtime/package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev && npm cache clean --force
COPY packages/chatgpt-pilot/dist ./dist
USER 1000:1000
ENTRYPOINT ["node", "dist/index.js"]
