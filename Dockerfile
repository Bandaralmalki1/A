FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY web ./web
# قاعدة البيانات والملفات المرفوعة تُحفظ هنا: اربط هذا المسار بقرص دائم
VOLUME /data
EXPOSE 3000
# يعمل بالمستخدم الافتراضي لأن الأقراص الدائمة في منصات الاستضافة تُربط بملكية root
CMD ["node", "server/index.js"]
