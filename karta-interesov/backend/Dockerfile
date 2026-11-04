FROM php:8.2-cli

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends zlib1g-dev libpng-dev libzip-dev default-mysql-client \
    && docker-php-ext-install pdo_mysql mysqli mbstring zip \
    && rm -rf /var/lib/apt/lists/*

COPY . /app

EXPOSE 10000

CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-10000} -t public public/index.php"]
