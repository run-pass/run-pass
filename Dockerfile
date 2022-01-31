FROM node:16

WORKDIR /usr/src/app

COPY ./pass-gen ./

RUN npm ci
RUN npm run build

EXPOSE 3000

CMD [ "npm", "run", "start:prod" ]